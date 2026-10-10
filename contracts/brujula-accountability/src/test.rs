#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env,
};

fn b(env: &Env, v: u8) -> BytesN<32> {
    BytesN::from_array(env, &[v; 32])
}

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);
    let admin = Address::generate(&env);
    (env, admin)
}

fn deploy<'a>(env: &'a Env, admin: &Address) -> ContractClient<'a> {
    let id = env.register(Contract, (admin.clone(),));
    ContractClient::new(env, &id)
}

#[test]
fn anchor_and_read_back() {
    let (env, admin) = setup();
    let c = deploy(&env, &admin);
    let author = Address::generate(&env);

    let id = c.anchor(
        &42,
        &b(&env, 0x11),
        &b(&env, 0x22),
        &symbol_short!("hermes"),
        &author,
    );
    assert_eq!(id, 1);

    let r = c.get(&id).unwrap();
    assert_eq!(r.proposal_id, 42);
    assert_eq!(r.report_hash, b(&env, 0x11));
    assert_eq!(r.evidence_hash, b(&env, 0x22));
    assert_eq!(r.kind, symbol_short!("hermes"));
    assert_eq!(r.author, author);
    assert_eq!(r.anchored_at, 1_000_000);
    assert_eq!(c.count(), 1);
}

#[test]
fn append_only_sequence() {
    let (env, admin) = setup();
    let c = deploy(&env, &admin);
    let author = Address::generate(&env);

    let a = c.anchor(
        &1,
        &b(&env, 0x01),
        &b(&env, 0x02),
        &symbol_short!("audit"),
        &author,
    );
    let d = c.anchor(
        &1,
        &b(&env, 0x03),
        &b(&env, 0x04),
        &symbol_short!("audit"),
        &author,
    );
    assert_eq!((a, d), (1, 2));
    assert_eq!(c.count(), 2);
    // both reports remain independently readable (no overwrite)
    assert_eq!(c.get(&1).unwrap().report_hash, b(&env, 0x01));
    assert_eq!(c.get(&2).unwrap().report_hash, b(&env, 0x03));
    assert_eq!(c.get(&3), None);
}

#[test]
fn admin_rotation() {
    let (env, admin) = setup();
    let c = deploy(&env, &admin);
    let new_admin = Address::generate(&env);
    c.set_admin(&new_admin);
    assert_eq!(c.admin(), new_admin);
}

// ---------------------------------------------------------------------------
// Append-only guarantees.
// ---------------------------------------------------------------------------

#[test]
fn the_log_is_append_only_and_ids_do_not_reuse() {
    let (env, admin) = setup();
    let c = deploy(&env, &admin);
    let a = Address::generate(&env);

    let first = c.anchor(
        &1,
        &b(&env, 0x11),
        &b(&env, 0x21),
        &symbol_short!("audit"),
        &a,
    );
    let second = c.anchor(
        &1,
        &b(&env, 0x12),
        &b(&env, 0x22),
        &symbol_short!("audit"),
        &a,
    );
    assert_eq!(first, 1);
    assert_eq!(second, 2);
    assert_eq!(c.count(), 2);

    // An earlier report is never mutated by a later one.
    let stored = c.get(&first).unwrap();
    assert_eq!(stored.report_hash, b(&env, 0x11));
    assert_eq!(stored.evidence_hash, b(&env, 0x21));
}

#[test]
fn any_address_may_anchor_and_the_author_is_recorded() {
    let (env, admin) = setup();
    let c = deploy(&env, &admin);
    let stranger = Address::generate(&env);

    let id = c.anchor(
        &7,
        &b(&env, 0x33),
        &b(&env, 0x44),
        &symbol_short!("tally"),
        &stranger,
    );
    let r = c.get(&id).unwrap();
    assert_eq!(r.author, stranger);
    assert_eq!(r.proposal_id, 7);
    assert_eq!(r.anchored_at, env.ledger().timestamp());
}

#[test]
fn the_author_must_authorize_the_anchor() {
    let (env, _admin) = setup();
    let c = deploy(&env, &Address::generate(&env));
    env.set_auths(&[]);
    let res = c.try_anchor(
        &1,
        &b(&env, 0x11),
        &b(&env, 0x22),
        &symbol_short!("audit"),
        &Address::generate(&env),
    );
    assert!(res.is_err(), "an unauthorized anchor must be rejected");
}

#[test]
fn unknown_report_ids_are_absent_not_empty() {
    let (env, admin) = setup();
    let c = deploy(&env, &admin);
    assert_eq!(c.get(&1), None);
    assert_eq!(c.count(), 0);

    let a = Address::generate(&env);
    c.anchor(
        &1,
        &b(&env, 0x11),
        &b(&env, 0x22),
        &symbol_short!("audit"),
        &a,
    );
    assert_eq!(c.get(&99), None);
}
