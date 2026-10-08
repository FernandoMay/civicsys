#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

fn b(env: &Env, v: u8) -> BytesN<32> {
    BytesN::from_array(env, &[v; 32])
}

const HOUR: u64 = 3_600;
const T0: u64 = 1_000_000;

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(T0);
    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    (env, admin, proposer)
}

fn deploy<'a>(env: &'a Env, admin: &Address) -> ContractClient<'a> {
    let id = env.register(Contract, (admin.clone(),));
    ContractClient::new(env, &id)
}

fn create(c: &ContractClient, env: &Env, proposer: &Address) -> u64 {
    c.create(
        proposer,
        &b(env, 0x01),
        &b(env, 0x02),
        &b(env, 0x03),
        &String::from_str(
            env,
            "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        ),
        &b(env, 0x04),
        &(T0 + HOUR),
        &(T0 + 10 * HOUR),
    )
}

#[test]
fn create_and_derive_status() {
    let (env, admin, proposer) = setup();
    let c = deploy(&env, &admin);
    let id = create(&c, &env, &proposer);

    // t=T0 < opens_at → SCHEDULED
    assert_eq!(c.status(&id), STATUS_SCHEDULED);
    assert!(!c.is_open(&id));

    env.ledger().set_timestamp(T0 + 2 * HOUR);
    assert_eq!(c.status(&id), STATUS_OPEN);
    assert!(c.is_open(&id));

    env.ledger().set_timestamp(T0 + 10 * HOUR);
    assert_eq!(c.status(&id), STATUS_CLOSED);
    assert!(!c.is_open(&id));

    let p = c.get(&id).unwrap();
    assert_eq!(p.proposer, proposer);
    assert_eq!(p.title_hash, b(&env, 0x01));
    assert_eq!(c.next_id(), 2);
}

#[test]
fn invalid_windows_rejected() {
    let (env, admin, proposer) = setup();
    let c = deploy(&env, &admin);
    // opens_at >= closes_at
    let res = c.try_create(
        &proposer,
        &b(&env, 0x01),
        &b(&env, 0x02),
        &b(&env, 0x03),
        &String::from_str(&env, "cid"),
        &b(&env, 0x04),
        &2_000_000,
        &1_000_000,
    );
    assert_eq!(res, Err(Ok(Error::InvalidWindow)));

    // closes_at in the past
    let res = c.try_create(
        &proposer,
        &b(&env, 0x01),
        &b(&env, 0x02),
        &b(&env, 0x03),
        &String::from_str(&env, "cid"),
        &b(&env, 0x04),
        &500_000,
        &999_999,
    );
    assert_eq!(res, Err(Ok(Error::InvalidWindow)));
}

#[test]
fn attach_evidence_appends() {
    let (env, admin, proposer) = setup();
    let c = deploy(&env, &admin);
    let id = create(&c, &env, &proposer);

    c.attach_evidence(&id, &b(&env, 0xaa), &symbol_short!("hermes"));
    c.attach_evidence(&id, &b(&env, 0xbb), &symbol_short!("manual"));

    let p = c.get(&id).unwrap();
    assert_eq!(p.evidence.len(), 2);
    assert_eq!(p.evidence.get(0).unwrap(), b(&env, 0xaa));
}

#[test]
fn cancel_is_terminal() {
    let (env, admin, proposer) = setup();
    let c = deploy(&env, &admin);
    let id = create(&c, &env, &proposer);

    c.cancel(&id, &b(&env, 0xcc));
    assert_eq!(c.status(&id), STATUS_CANCELLED);
    assert!(!c.is_open(&id));
    assert_eq!(
        c.try_cancel(&id, &b(&env, 0xcd)),
        Err(Ok(Error::AlreadyCancelled))
    );

    // evidence cannot be attached to a cancelled proposal
    let res = c.try_attach_evidence(&id, &b(&env, 0xaa), &symbol_short!("hermes"));
    assert_eq!(res, Err(Ok(Error::AlreadyCancelled)));
}

#[test]
fn unknown_proposal_is_closed_not_found() {
    let (env, admin, _proposer) = setup();
    let c = deploy(&env, &admin);
    assert_eq!(c.try_status(&99), Err(Ok(Error::NotFound)));
    assert!(!c.is_open(&99));
    assert_eq!(c.get(&99), None);
}

#[test]
fn cid_length_enforced() {
    let (env, admin, proposer) = setup();
    let c = deploy(&env, &admin);
    let long_cid = String::from_str(&env, &"x".repeat(129));
    let res = c.try_create(
        &proposer,
        &b(&env, 0x01),
        &b(&env, 0x02),
        &b(&env, 0x03),
        &long_cid,
        &b(&env, 0x04),
        &(T0 + HOUR),
        &(T0 + 10 * HOUR),
    );
    assert_eq!(res, Err(Ok(Error::CidTooLong)));
}
