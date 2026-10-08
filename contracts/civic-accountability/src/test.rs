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
