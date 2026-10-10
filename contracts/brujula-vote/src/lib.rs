#![no_std]

//! BrujulaVote — ballots, nullifiers, tally.
//!
//! Source of truth: docs/rfc/BRUJULA-CIVICA-ARCH-001.md §3.3
//!
//! Honesty rule (RFC §0.4): commitment ballots are recorded with
//! `verification_mode = "commitment_v1"` — **never** `zk_*`. Until a verifier
//! contract exists (Phase 4), commitment ballots carry membership claims that
//! are *unverified* and must surface as UNVERIFIED_COMMITMENT off-chain.

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, symbol_short, Address, BytesN, Env, Map, Symbol,
};

const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 1_000_000;

/// Minimal interface of BrujulaIdentity (RFC §3.1).
#[contractclient(name = "IdentityClient")]
pub trait IdentityInterface {
    fn is_eligible(env: Env, subject: Address) -> bool;
}

/// Minimal interface of BrujulaProposal (RFC §3.2).
#[contractclient(name = "ProposalClient")]
pub trait ProposalInterface {
    fn exists(env: Env, id: u64) -> bool;
    fn is_open(env: Env, id: u64) -> bool;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotAdmin = 1,
    ProposalNotFound = 2,
    ProposalNotOpen = 3,
    NotEligible = 4,
    AlreadyVoted = 5,
    RootNotSet = 6,
    RootMismatch = 7,
    NullifierUsed = 8,
    NotFound = 9,
    /// Signer set was empty or contained duplicates.
    InvalidSignerSet = 10,
    /// `execute_admin_rotation` called with nothing scheduled.
    NoPendingRotation = 11,
    /// Rotation scheduled but the delay has not elapsed yet.
    RotationNotReady = 12,
}

/// Delay before a scheduled admin rotation takes effect (seconds).
///
/// A rotation is public and observable via `pending_admin_rotation`, and the
/// outgoing signers keep full authority until it executes, so a compromised key
/// cannot move control to itself unnoticed.
pub const ADMIN_ROTATION_DELAY: u64 = 86_400;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Tally {
    pub proposal_id: u64,
    pub total: u64,
    pub counts: Map<u32, u64>,
    pub public_votes: u64,
    pub commitment_votes: u64,
    /// Strongest verification mode present in this tally:
    /// `public_v1` → `commitment_v1` on first commitment ballot. Never `zk_*`.
    pub verification_mode: Symbol,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Tally(u64),
    PublicVote(u64, Address),
    Nullifier(u64, BytesN<32>),
    Root(u64),
}

#[contractevent]
pub struct VoteCastPublic {
    #[topic]
    pub proposal_id: u64,
    pub voter: Address,
    pub choice: u32,
}

#[contractevent]
pub struct MembershipRootSet {
    #[topic]
    pub proposal_id: u64,
    pub root: BytesN<32>,
}

#[contractevent]
pub struct VoteCastCommitment {
    #[topic]
    pub proposal_id: u64,
    pub nullifier: BytesN<32>,
    pub commitment: BytesN<32>,
    pub verifier_digest: BytesN<32>,
    pub choice: u32,
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

fn instance_get_address(env: &Env, key: soroban_sdk::Symbol) -> Address {
    env.storage()
        .instance()
        .get(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotAdmin))
}

fn get_or_create_tally(env: &Env, proposal_id: u64) -> Tally {
    env.storage()
        .persistent()
        .get(&DataKey::Tally(proposal_id))
        .unwrap_or(Tally {
            proposal_id,
            total: 0,
            counts: Map::new(env),
            public_votes: 0,
            commitment_votes: 0,
            verification_mode: Symbol::new(env, "public_v1"),
        })
}

fn save_tally(env: &Env, t: &Tally) {
    let key = DataKey::Tally(t.proposal_id);
    env.storage().persistent().set(&key, t);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Cross-contract preconditions (RFC §3.3): proposal must exist and be open.
fn require_open(env: &Env, proposal_id: u64) {
    let proposal_addr = instance_get_address(env, symbol_short!("proposal"));
    let client = ProposalClient::new(env, &proposal_addr);
    if !client.exists(&proposal_id) {
        panic_with_error!(env, Error::ProposalNotFound);
    }
    if !client.is_open(&proposal_id) {
        panic_with_error!(env, Error::ProposalNotOpen);
    }
}

#[contractimpl]
impl Contract {
    pub fn __constructor(env: Env, admin: Address, identity: Address, proposal: Address) {
        // Bootstrap: a single signer. Widen with `set_signers`, which requires
        // the current signers, so control is never narrowed silently.
        let mut set = soroban_sdk::Vec::new(&env);
        set.push_back(admin);
        env.storage().instance().set(&KEY_SIGNERS, &set);
        // Cross-contract wiring. These are read on every ballot, so dropping
        // them would make the vote contract silently reject every credential.
        env.storage()
            .instance()
            .set(&symbol_short!("identity"), &identity);
        env.storage()
            .instance()
            .set(&symbol_short!("proposal"), &proposal);
        touch_admin(&env);
    }

    /// Public ballot: wallet-addressed, one per (proposal, voter).
    /// Requires an ACTIVE, eligible credential in BrujulaIdentity. [voter]
    pub fn cast_public(env: Env, proposal_id: u64, voter: Address, choice: u32) -> Tally {
        voter.require_auth();
        require_open(&env, proposal_id);

        let identity_addr = instance_get_address(&env, symbol_short!("identity"));
        let identity = IdentityClient::new(&env, &identity_addr);
        if !identity.is_eligible(&voter) {
            panic_with_error!(env, Error::NotEligible);
        }

        let voted_key = DataKey::PublicVote(proposal_id, voter.clone());
        if env.storage().persistent().has(&voted_key) {
            panic_with_error!(env, Error::AlreadyVoted);
        }
        env.storage().persistent().set(&voted_key, &true);
        bump(&env, &voted_key);

        let mut t = get_or_create_tally(&env, proposal_id);
        t.total += 1;
        t.public_votes += 1;
        let choice_count = t.counts.get(choice).unwrap_or(0);
        t.counts.set(choice, choice_count + 1);
        save_tally(&env, &t);

        VoteCastPublic {
            proposal_id,
            voter,
            choice,
        }
        .publish(&env);
        t
    }

    /// Set the Merkle root of eligible commitments for a proposal. [admin]
    pub fn set_membership_root(env: Env, proposal_id: u64, root: BytesN<32>) {
        require_admin(&env);
        let key = DataKey::Root(proposal_id);
        env.storage().persistent().set(&key, &root);
        bump(&env, &key);
        MembershipRootSet { proposal_id, root }.publish(&env);
    }

    /// Privacy-preserving **commitment** ballot (`commitment_v1`, NOT ZK).
    ///
    /// v0.1 checks: window open, membership root matches the admin-set root,
    /// nullifier unseen. Membership is *claimed*, not proven — the off-chain
    /// verifier must report UNVERIFIED_COMMITMENT until Phase 4 (`zk_v1`).
    pub fn cast_commitment(
        env: Env,
        proposal_id: u64,
        choice: u32,
        nullifier: BytesN<32>,
        commitment: BytesN<32>,
        membership_root: BytesN<32>,
        verifier_digest: BytesN<32>,
    ) -> Tally {
        require_open(&env, proposal_id);

        let root_key = DataKey::Root(proposal_id);
        let stored_root: BytesN<32> = env
            .storage()
            .persistent()
            .get(&root_key)
            .unwrap_or_else(|| panic_with_error!(env, Error::RootNotSet));
        if stored_root != membership_root {
            panic_with_error!(env, Error::RootMismatch);
        }

        let nullifier_key = DataKey::Nullifier(proposal_id, nullifier.clone());
        if env.storage().persistent().has(&nullifier_key) {
            panic_with_error!(env, Error::NullifierUsed);
        }
        // value = the unproven membership claim, kept for audit
        env.storage().persistent().set(&nullifier_key, &commitment);
        bump(&env, &nullifier_key);

        let mut t = get_or_create_tally(&env, proposal_id);
        t.total += 1;
        t.commitment_votes += 1;
        t.verification_mode = Symbol::new(&env, "commitment_v1");
        let choice_count = t.counts.get(choice).unwrap_or(0);
        t.counts.set(choice, choice_count + 1);
        save_tally(&env, &t);

        VoteCastCommitment {
            proposal_id,
            nullifier,
            commitment,
            verifier_digest,
            choice,
        }
        .publish(&env);
        t
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

    pub fn identity_contract(env: Env) -> Address {
        instance_get_address(&env, symbol_short!("identity"))
    }

    pub fn proposal_contract(env: Env) -> Address {
        instance_get_address(&env, symbol_short!("proposal"))
    }

    pub fn get_tally(env: Env, proposal_id: u64) -> Option<Tally> {
        env.storage().persistent().get(&DataKey::Tally(proposal_id))
    }

    pub fn has_voted_public(env: Env, proposal_id: u64, voter: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::PublicVote(proposal_id, voter))
    }

    pub fn nullifier_seen(env: Env, proposal_id: u64, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(proposal_id, nullifier))
    }

    pub fn membership_root(env: Env, proposal_id: u64) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::Root(proposal_id))
    }
}

mod test;
