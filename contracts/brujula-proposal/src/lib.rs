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
}

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

fn require_admin(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&symbol_short!("admin"))
        .unwrap_or_else(|| panic_with_error!(env, Error::NotAdmin));
    admin.require_auth();
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

#[contractimpl]
impl Contract {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &admin);
        env.storage()
            .instance()
            .set(&symbol_short!("next_id"), &1u64);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
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

    /// Rotate the admin key. [admin]
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        require_admin(&env);
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &new_admin);
        AdminChanged { new_admin }.publish(&env);
        Ok(())
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&symbol_short!("admin"))
            .unwrap_or_else(|| panic_with_error!(env, Error::NotAdmin))
    }

    pub fn next_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&symbol_short!("next_id"))
            .unwrap_or(1)
    }
}

mod test;
