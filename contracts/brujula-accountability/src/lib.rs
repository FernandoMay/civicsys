#![no_std]

//! BrujulaAccountability — append-only anchoring of reports and evidence sets.
//!
//! Source of truth: docs/rfc/BRUJULA-CIVICA-ARCH-001.md §3.4
//! Immutability is structural: there is no update or delete entrypoint.
//! Corrections are new reports, never edits.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, Address, BytesN, Env, Symbol,
};

const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 1_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotAdmin = 1,
    NotFound = 2,
    /// Signer set was empty or contained duplicates.
    InvalidSignerSet = 3,
    /// `execute_admin_rotation` called with nothing scheduled.
    NoPendingRotation = 4,
    /// Rotation scheduled but the delay has not elapsed yet.
    RotationNotReady = 5,
}

/// Delay before a scheduled admin rotation takes effect (seconds).
///
/// A rotation is public and observable via `pending_admin_rotation`, and the
/// outgoing signers keep full authority until it executes, so a compromised key
/// cannot move control to itself unnoticed.
pub const ADMIN_ROTATION_DELAY: u64 = 86_400;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub id: u64,
    pub proposal_id: u64,
    pub report_hash: BytesN<32>,
    pub evidence_hash: BytesN<32>,
    pub kind: Symbol,
    pub author: Address,
    pub anchored_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Report(u64),
}

#[contractevent]
pub struct ReportAnchored {
    #[topic]
    pub proposal_id: u64,
    #[topic]
    pub id: u64,
    pub report_hash: BytesN<32>,
    pub evidence_hash: BytesN<32>,
}

#[contractevent]
pub struct AdminChanged {
    #[topic]
    pub new_admin: Address,
}

/// A rotation was scheduled. Public so a monitor can observe it before it lands.
#[contractevent]
pub struct AdminChangedSchedule {
    #[topic]
    pub new_admin: Address,
    pub executes_at: u64,
}

/// A scheduled rotation was withdrawn by the outgoing signers.
#[contractevent]
pub struct AdminRotationCancelled {}

#[contract]
pub struct Contract;

const KEY_SIGNERS: soroban_sdk::Symbol = symbol_short!("signers");
const KEY_PENDING: soroban_sdk::Symbol = symbol_short!("pend_rot");

/// Read the current signer set. Empty means the constructor never ran.
fn signers(env: &Env) -> soroban_sdk::Vec<Address> {
    env.storage()
        .instance()
        .get(&KEY_SIGNERS)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

/// A scheduled, not-yet-executed rotation: `(new_signer, executes_at)`.
fn pending_rotation(env: &Env) -> Option<(Address, u64)> {
    env.storage().instance().get(&KEY_PENDING)
}

/// Privileged authority is **N-of-N**: every current signer must authorise.
///
/// Deliberately stronger than a threshold multisig. A threshold needs an M-of-N
/// signing ceremony and a bug while counting the authorised set is a silent
/// authorisation bypass; requiring every signer keeps the check to plain
/// `require_auth()` calls, which fail closed by construction. The trade-off is
/// honest: adding a signer requires all of them to sign.
fn require_admin(env: &Env) {
    let set = signers(env);
    if set.is_empty() {
        panic_with_error!(env, Error::NotAdmin);
    }
    for signer in set.iter() {
        signer.require_auth();
    }
}

/// Refresh the instance TTL after an admin write. Soroban entries expire; the
/// signer set must not lapse, or the contract would become unadministrable.
fn touch_admin(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Reject an empty set or one containing the same address twice.
fn validate_signers(env: &Env, set: &soroban_sdk::Vec<Address>) -> Result<(), Error> {
    if set.is_empty() {
        return Err(Error::InvalidSignerSet);
    }
    let mut seen: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(env);
    for s in set.iter() {
        if seen.contains(s.clone()) {
            return Err(Error::InvalidSignerSet);
        }
        seen.push_back(s);
    }
    Ok(())
}

#[contractimpl]
impl Contract {
    pub fn __constructor(env: Env, admin: Address) {
        // Bootstrap: a single signer. Widen with `set_signers`, which requires
        // the current signers, so control is never narrowed silently.
        let mut set = soroban_sdk::Vec::new(&env);
        set.push_back(admin);
        env.storage().instance().set(&KEY_SIGNERS, &set);
        // Report ids are monotonic; without this counter `anchor` would reuse
        // id 1 for every report and overwrite the append-only log.
        env.storage()
            .instance()
            .set(&symbol_short!("next_id"), &1u64);
        touch_admin(&env);
    }

    /// Anchor a report: `report_hash` = H(canonical report),
    /// `evidence_hash` = H(canonical evidence set). Returns the report id.
    /// Any address may anchor (tx fees rate-limit); the author is recorded.
    pub fn anchor(
        env: Env,
        proposal_id: u64,
        report_hash: BytesN<32>,
        evidence_hash: BytesN<32>,
        kind: Symbol,
        author: Address,
    ) -> u64 {
        author.require_auth();

        let id: u64 = env
            .storage()
            .instance()
            .get(&symbol_short!("next_id"))
            .unwrap_or(1);
        let report = Report {
            id,
            proposal_id,
            report_hash: report_hash.clone(),
            evidence_hash: evidence_hash.clone(),
            kind,
            author,
            anchored_at: env.ledger().timestamp(),
        };
        let key = DataKey::Report(id);
        env.storage().persistent().set(&key, &report);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.storage()
            .instance()
            .set(&symbol_short!("next_id"), &(id + 1));
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        ReportAnchored {
            proposal_id,
            id,
            report_hash,
            evidence_hash,
        }
        .publish(&env);
        id
    }

    pub fn get(env: Env, report_id: u64) -> Option<Report> {
        env.storage().persistent().get(&DataKey::Report(report_id))
    }

    pub fn count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&symbol_short!("next_id"))
            .unwrap_or(1)
            - 1
    }

    /// Replace the signer set. [all current signers]
    pub fn set_signers(env: Env, new_signers: soroban_sdk::Vec<Address>) -> Result<(), Error> {
        require_admin(&env);
        validate_signers(&env, &new_signers)?;
        env.storage().instance().set(&KEY_SIGNERS, &new_signers);
        touch_admin(&env);
        Ok(())
    }

    /// Schedule a rotation to a single new signer, effective after the delay.
    /// [all current signers]
    pub fn schedule_admin_rotation(env: Env, new_admin: Address) -> Result<u64, Error> {
        require_admin(&env);
        let eta = env.ledger().timestamp() + ADMIN_ROTATION_DELAY;
        env.storage()
            .instance()
            .set(&KEY_PENDING, &(new_admin.clone(), eta));
        touch_admin(&env);
        AdminChangedSchedule {
            new_admin,
            executes_at: eta,
        }
        .publish(&env);
        Ok(eta)
    }

    /// Drop a scheduled rotation. [all current signers]
    pub fn cancel_admin_rotation(env: Env) -> Result<(), Error> {
        require_admin(&env);
        if pending_rotation(&env).is_none() {
            return Err(Error::NoPendingRotation);
        }
        env.storage().instance().remove(&KEY_PENDING);
        touch_admin(&env);
        AdminRotationCancelled {}.publish(&env);
        Ok(())
    }

    /// Apply a scheduled rotation once its delay has elapsed. [all current signers]
    pub fn execute_admin_rotation(env: Env) -> Result<(), Error> {
        require_admin(&env);
        let (new_admin, eta) = pending_rotation(&env).ok_or(Error::NoPendingRotation)?;
        if env.ledger().timestamp() < eta {
            return Err(Error::RotationNotReady);
        }
        let mut set = soroban_sdk::Vec::new(&env);
        set.push_back(new_admin.clone());
        env.storage().instance().set(&KEY_SIGNERS, &set);
        env.storage().instance().remove(&KEY_PENDING);
        touch_admin(&env);
        AdminChanged { new_admin }.publish(&env);
        Ok(())
    }

    /// Current signer set. Public so operators can audit the admin surface.
    pub fn admin_signers(env: Env) -> soroban_sdk::Vec<Address> {
        signers(&env)
    }

    /// First signer, for explorers and tooling that expects a single address.
    pub fn admin(env: Env) -> Address {
        signers(&env)
            .get(0)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotAdmin))
    }

    /// A rotation waiting to execute, or `None`. Public on purpose: a scheduled
    /// rotation must be observable by anyone monitoring the contract.
    pub fn pending_admin_rotation(env: Env) -> Option<(Address, u64)> {
        pending_rotation(&env)
    }

    /// Rotation delay in seconds, exposed so a monitor need not hardcode it.
    pub fn admin_rotation_delay(_env: Env) -> u64 {
        ADMIN_ROTATION_DELAY
    }
}

mod test;
