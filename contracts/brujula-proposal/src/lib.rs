#![no_std]
// RFC BRUJULA-CIVICA-ARCH-001 §3.2 freezes `Proposal::create`'s 8-argument
// interface; the `#[contractimpl]`-generated wrappers trip clippy's
// too_many_arguments and carry the macro's span, so the suppression must be
// crate-wide.
#![allow(clippy::too_many_arguments)]

//! BrujulaProposal — proposal provenance and lifecycle windows.
//!
//! Source of truth: docs/rfc/BRUJULA-CIVICA-ARCH-001.md §3.2
//! Heavy content stays off-chain (IPFS CID + content hashes on-chain)

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, Address, BytesN, Env, String, Symbol, Vec,
};

/// Computed status values (RFC §1: status is derived, never mutable truth).
pub const STATUS_SCHEDULED: u32 = 0;
pub const STATUS_OPEN: u32 = 1;
pub const STATUS_CLOSED: u32 = 2;
pub const STATUS_CANCELLED: u32 = 3;

const MAX_CID_LEN: u32 = 128;
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 1_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotAdmin = 1,
    NotProposer = 2,
    NotFound = 3,
    InvalidWindow = 4,
    AlreadyCancelled = 5,
    CidTooLong = 6,
    InvalidId = 7,
    /// Signer set was empty or contained duplicates.
    InvalidSignerSet = 8,
    /// `execute_admin_rotation` called with nothing scheduled.
    NoPendingRotation = 9,
    /// Rotation scheduled but the delay has not elapsed yet.
    RotationNotReady = 10,
}

/// Delay before a scheduled admin rotation takes effect (seconds).
///
/// A rotation is public and observable via `pending_admin_rotation`, and the
/// outgoing signers keep full authority until it executes, so a compromised key
/// cannot move control to itself unnoticed.
pub const ADMIN_ROTATION_DELAY: u64 = 86_400;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub title_hash: BytesN<32>,
    pub description_hash: BytesN<32>,
    pub metadata_hash: BytesN<32>,
    pub content_cid: String,
    pub evidence_root: BytesN<32>,
    pub created_at: u64,
    pub opens_at: u64,
    pub closes_at: u64,
    pub cancelled: bool,
    pub cancel_reason_hash: Option<BytesN<32>>,
    pub evidence: Vec<BytesN<32>>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Proposal(u64),
}

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

fn load(env: &Env, id: u64) -> Proposal {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::NotFound))
}

fn save(env: &Env, p: &Proposal) {
    let key = DataKey::Proposal(p.id);
    env.storage().persistent().set(&key, p);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn compute_status(env: &Env, p: &Proposal) -> u32 {
    if p.cancelled {
        return STATUS_CANCELLED;
    }
    let now = env.ledger().timestamp();
    if now < p.opens_at {
        STATUS_SCHEDULED
    } else if now < p.closes_at {
        STATUS_OPEN
    } else {
        STATUS_CLOSED
    }
}

#[contractevent]
pub struct ProposalCreated {
    #[topic]
    pub id: u64,
    pub title_hash: BytesN<32>,
    pub content_cid: String,
    pub evidence_root: BytesN<32>,
}

#[contractevent]
pub struct ProposalEvidenceAttached {
    #[topic]
    pub id: u64,
    #[topic]
    pub source: Symbol,
    pub evidence_hash: BytesN<32>,
}

#[contractevent]
pub struct ProposalCancelled {
    #[topic]
    pub id: u64,
    pub reason_hash: BytesN<32>,
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

#[contractimpl]
impl Contract {
    pub fn __constructor(env: Env, admin: Address) {
        // Bootstrap: a single signer. Widen with `set_signers`, which requires
        // the current signers, so control is never narrowed silently.
        let mut set = soroban_sdk::Vec::new(&env);
        set.push_back(admin);
        env.storage().instance().set(&KEY_SIGNERS, &set);
        // Ids are monotonic. Without this counter every `create` would read the
        // `unwrap_or(1)` fallback and hand out id 1 forever.
        env.storage()
            .instance()
            .set(&symbol_short!("next_id"), &1u64);
        touch_admin(&env);
    }

    /// Create a proposal. Content lives off-chain behind `content_cid`;
    /// only hashes are anchored. Returns the new proposal id. [proposer]
    pub fn create(
        env: Env,
        proposer: Address,
        title_hash: BytesN<32>,
        description_hash: BytesN<32>,
        metadata_hash: BytesN<32>,
        content_cid: String,
        evidence_root: BytesN<32>,
        opens_at: u64,
        closes_at: u64,
    ) -> Result<u64, Error> {
        proposer.require_auth();
        if opens_at >= closes_at || closes_at <= env.ledger().timestamp() {
            return Err(Error::InvalidWindow);
        }
        if content_cid.len() > MAX_CID_LEN {
            return Err(Error::CidTooLong);
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&symbol_short!("next_id"))
            .unwrap_or(1);
        let p = Proposal {
            id,
            proposer: proposer.clone(),
            title_hash,
            description_hash,
            metadata_hash,
            content_cid,
            evidence_root,
            created_at: env.ledger().timestamp(),
            opens_at,
            closes_at,
            cancelled: false,
            cancel_reason_hash: None,
            evidence: Vec::new(&env),
        };
        save(&env, &p);
        env.storage()
            .instance()
            .set(&symbol_short!("next_id"), &(id + 1));
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        ProposalCreated {
            id: p.id,
            title_hash: p.title_hash.clone(),
            content_cid: p.content_cid.clone(),
            evidence_root: p.evidence_root.clone(),
        }
        .publish(&env);
        Ok(id)
    }

    pub fn get(env: Env, id: u64) -> Option<Proposal> {
        env.storage().persistent().get(&DataKey::Proposal(id))
    }

    /// Existence check used by BrujulaVote (RFC §3.3 cross-contract interface).
    pub fn exists(env: Env, id: u64) -> bool {
        env.storage().persistent().has(&DataKey::Proposal(id))
    }

    /// Derived status — never stored (RFC §1).
    pub fn status(env: Env, id: u64) -> Result<u32, Error> {
        Ok(compute_status(&env, &load(&env, id)))
    }

    pub fn is_open(env: Env, id: u64) -> Result<bool, Error> {
        match env
            .storage()
            .persistent()
            .get::<_, Proposal>(&DataKey::Proposal(id))
        {
            Some(p) => Ok(compute_status(&env, &p) == STATUS_OPEN),
            None => Ok(false),
        }
    }

    /// Append an evidence hash to the proposal's evidence log. [proposer]
    pub fn attach_evidence(
        env: Env,
        id: u64,
        evidence_hash: BytesN<32>,
        source: soroban_sdk::Symbol,
    ) -> Result<(), Error> {
        let mut p = load(&env, id);
        p.proposer.require_auth();
        if p.cancelled {
            return Err(Error::AlreadyCancelled);
        }
        p.evidence.push_back(evidence_hash.clone());
        save(&env, &p);
        ProposalEvidenceAttached {
            id,
            source,
            evidence_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Cancel a proposal. [admin]
    pub fn cancel(env: Env, id: u64, reason_hash: BytesN<32>) -> Result<Proposal, Error> {
        require_admin(&env);
        let mut p = load(&env, id);
        if p.cancelled {
            return Err(Error::AlreadyCancelled);
        }
        p.cancelled = true;
        p.cancel_reason_hash = Some(reason_hash.clone());
        save(&env, &p);
        ProposalCancelled { id, reason_hash }.publish(&env);
        Ok(p)
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

    pub fn next_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&symbol_short!("next_id"))
            .unwrap_or(1)
    }
}

mod test;
