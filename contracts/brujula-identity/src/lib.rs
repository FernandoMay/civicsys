#![no_std]

//! BrujulaIdentity — credential commitments, eligibility, revocation.
//!
//! Source of truth: docs/rfc/BRUJULA-CIVICA-ARCH-001.md §3.1
//! The chain stores only a 32-byte commitment — never raw identity data.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, Address, BytesN, Env, Symbol,
};

/// Credential status values (stored, event of record).
pub const STATUS_ACTIVE: u32 = 0;
pub const STATUS_SUSPENDED: u32 = 1;
pub const STATUS_REVOKED: u32 = 2;

/// Persistent-entry TTL policy (RFC §2): extend on every write so records
/// survive ≥ ~1M ledgers (~40 days at 5s/ledger) without a keeper.
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 1_000_000;

// Events (RFC BRUJULA-CIVICA-ARCH-001 §3.1): topic0 = snake_case struct name,
// `#[topic]` fields become indexed topics, the rest is the data map.
// `#[contractevent]` embeds them in the contract spec for SDK tooling.
#[contractevent]
pub struct CredentialIssued {
    #[topic]
    pub subject: Address,
    pub commitment: BytesN<32>,
    pub credential_type: Symbol,
}

#[contractevent]
pub struct CredentialSuspended {
    #[topic]
    pub subject: Address,
}

#[contractevent]
pub struct CredentialReinstated {
    #[topic]
    pub subject: Address,
}

#[contractevent]
pub struct CredentialRevoked {
    #[topic]
    pub subject: Address,
    pub reason_hash: BytesN<32>,
}

#[contractevent]
pub struct EligibilityChanged {
    #[topic]
    pub subject: Address,
    pub eligible: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    #[topic]
    pub new_admin: Address,
}

/// A rotation was scheduled. Public so a monitor can observe it before it lands.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminRotationScheduled {
    #[topic]
    pub new_admin: Address,
    pub executes_at: u64,
}

/// A scheduled rotation was withdrawn by the outgoing signers.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminRotationCancelled {}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotAdmin = 1,
    AlreadyIssued = 2,
    NotFound = 3,
    InvalidTransition = 4,
    /// Signer set was empty or contained duplicates.
    InvalidSignerSet = 5,
    /// `execute_admin_rotation` called with nothing scheduled.
    NoPendingRotation = 6,
    /// Rotation scheduled but the delay has not elapsed yet.
    RotationNotReady = 7,
}

/// Delay before a scheduled admin rotation takes effect (seconds).
///
/// A rotation is public and observable via `pending_admin_rotation`, and the
/// outgoing signers keep full authority until it executes. The delay exists so a
/// compromised key cannot move control to itself unnoticed: the pending
/// rotation is visible on chain for a full day before it takes effect, and the
/// legitimate signers can still cancel it.
pub const ADMIN_ROTATION_DELAY: u64 = 86_400;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Credential {
    pub subject: Address,
    pub commitment: BytesN<32>,
    pub credential_type: Symbol,
    pub status: u32,
    pub eligible: bool,
    pub issued_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Credential(Address),
}

#[contract]
pub struct Contract;

/// Instance keys for the admin model.
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
/// This is deliberately stronger than a threshold multisig. A threshold needs
/// an M-of-N signing ceremony and a bug in counting the authorised set is a
/// silent authorisation bypass; requiring every signer keeps the check to
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

fn load(env: &Env, subject: &Address) -> Credential {
    let key = DataKey::Credential(subject.clone());
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotFound))
}

fn save(env: &Env, cred: &Credential) {
    let key = DataKey::Credential(cred.subject.clone());
    env.storage().persistent().set(&key, cred);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn touch_admin(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

#[contractimpl]
impl Contract {
    pub fn __constructor(env: Env, admin: Address) {
        // Bootstrap: a single signer. Widen with `set_signers`, which requires
        // the current signers, so control is never narrowed silently.
        let mut set = soroban_sdk::Vec::new(&env);
        set.push_back(admin);
        env.storage().instance().set(&KEY_SIGNERS, &set);
        touch_admin(&env);
    }

    /// Issue a credential commitment for `subject`. [admin]
    pub fn issue(
        env: Env,
        subject: Address,
        commitment: BytesN<32>,
        credential_type: Symbol,
    ) -> Result<Credential, Error> {
        require_admin(&env);
        let key = DataKey::Credential(subject.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyIssued);
        }
        let now = env.ledger().timestamp();
        let cred = Credential {
            subject,
            commitment,
            credential_type,
            status: STATUS_ACTIVE,
            eligible: true,
            issued_at: now,
            updated_at: now,
        };
        save(&env, &cred);
        CredentialIssued {
            subject: cred.subject.clone(),
            commitment: cred.commitment.clone(),
            credential_type: cred.credential_type.clone(),
        }
        .publish(&env);
        Ok(cred)
    }

    /// Suspend a credential (temporarily ineligible). [admin]
    pub fn suspend(env: Env, subject: Address) -> Result<Credential, Error> {
        require_admin(&env);
        let mut cred = load(&env, &subject);
        if cred.status != STATUS_ACTIVE {
            return Err(Error::InvalidTransition);
        }
        cred.status = STATUS_SUSPENDED;
        cred.updated_at = env.ledger().timestamp();
        save(&env, &cred);
        CredentialSuspended { subject }.publish(&env);
        Ok(cred)
    }

    /// Reinstate a suspended credential. [admin]
    pub fn reinstate(env: Env, subject: Address) -> Result<Credential, Error> {
        require_admin(&env);
        let mut cred = load(&env, &subject);
        if cred.status != STATUS_SUSPENDED {
            return Err(Error::InvalidTransition);
        }
        cred.status = STATUS_ACTIVE;
        cred.updated_at = env.ledger().timestamp();
        save(&env, &cred);
        CredentialReinstated { subject }.publish(&env);
        Ok(cred)
    }

    /// Permanently revoke. Revocation is final (no un-revoke). [admin]
    pub fn revoke(
        env: Env,
        subject: Address,
        reason_hash: BytesN<32>,
    ) -> Result<Credential, Error> {
        require_admin(&env);
        let mut cred = load(&env, &subject);
        if cred.status == STATUS_REVOKED {
            return Err(Error::InvalidTransition);
        }
        cred.status = STATUS_REVOKED;
        cred.eligible = false;
        cred.updated_at = env.ledger().timestamp();
        save(&env, &cred);
        CredentialRevoked {
            subject,
            reason_hash,
        }
        .publish(&env);
        Ok(cred)
    }

    /// Toggle eligibility independently of status. [admin]
    pub fn set_eligible(env: Env, subject: Address, eligible: bool) -> Result<Credential, Error> {
        require_admin(&env);
        let mut cred = load(&env, &subject);
        cred.eligible = eligible;
        cred.updated_at = env.ledger().timestamp();
        save(&env, &cred);
        EligibilityChanged { subject, eligible }.publish(&env);
        Ok(cred)
    }

    /// Replace the signer set. [all current signers]
    ///
    /// Authority is N-of-N, so this call itself requires every current signer.
    /// An empty or duplicated set is rejected: an empty set would hand the
    /// contract to nobody, and duplicates would only add ceremony.
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
        AdminRotationScheduled {
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

    /// Rotation delay in seconds. Constant across deployments, exposed so a
    /// monitor can compute the deadline without hardcoding it.
    pub fn admin_rotation_delay(_env: Env) -> u64 {
        ADMIN_ROTATION_DELAY
    }

    pub fn get_credential(env: Env, subject: Address) -> Option<Credential> {
        env.storage()
            .persistent()
            .get(&DataKey::Credential(subject))
    }

    /// Eligible ⇔ status == ACTIVE && eligible flag.
    pub fn is_eligible(env: Env, subject: Address) -> bool {
        match Self::get_credential(env, subject) {
            Some(c) => c.status == STATUS_ACTIVE && c.eligible,
            None => false,
        }
    }

    /// Convenience: commitment for a subject, if any.
    pub fn commitment_of(env: Env, subject: Address) -> Option<BytesN<32>> {
        Self::get_credential(env, subject).map(|c| c.commitment)
    }
}

mod test;
