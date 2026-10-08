#![no_std]

//! CivicIdentity — credential commitments, eligibility, revocation.
//!
//! Source of truth: docs/rfc/CIVICSYS-ARCH-001.md §3.1
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

// Events (RFC CIVICSYS-ARCH-001 §3.1): topic0 = snake_case struct name,
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
pub struct AdminChanged {
    #[topic]
    pub new_admin: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotAdmin = 1,
    AlreadyIssued = 2,
    NotFound = 3,
    InvalidTransition = 4,
}

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

fn require_admin(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&symbol_short!("admin"))
        .unwrap_or_else(|| panic_with_error!(env, Error::NotAdmin));
    admin.require_auth();
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
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &admin);
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

    /// Rotate the admin key. [admin]
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        require_admin(&env);
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &new_admin);
        touch_admin(&env);
        AdminChanged { new_admin }.publish(&env);
        Ok(())
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&symbol_short!("admin"))
            .unwrap_or_else(|| panic_with_error!(env, Error::NotAdmin))
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
