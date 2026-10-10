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
}

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

    /// Rotate the admin key. [admin]
    pub fn set_admin(env: Env, new_admin: Address) {
        require_admin(&env);
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &new_admin);
        AdminChanged { new_admin }.publish(&env);
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&symbol_short!("admin"))
            .unwrap_or_else(|| panic_with_error!(env, Error::NotAdmin))
    }
}

mod test;
