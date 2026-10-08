#![cfg(test)]

use super::*;
use soroban_sdk::{symbol_short, testutils::Address as _, Address, BytesN, Env};

fn b(env: &Env, v: u8) -> BytesN<32> {
    BytesN::from_array(env, &[v; 32])
}

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subject = Address::generate(&env);
    (env, admin, subject)
}

fn deploy<'a>(env: &'a Env, admin: &Address) -> ContractClient<'a> {
    let id = env.register(Contract, (admin.clone(),));
    ContractClient::new(env, &id)
}

#[test]
fn issue_and_check_eligibility() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);

    let commitment = b(&env, 0x01);
    let cred = c.issue(&subject, &commitment, &symbol_short!("citizen"));

    assert_eq!(cred.status, STATUS_ACTIVE);
    assert!(cred.eligible);
    assert_eq!(cred.commitment, commitment);
    assert!(c.is_eligible(&subject));
    assert_eq!(c.commitment_of(&subject), Some(commitment));
    assert_eq!(c.admin(), admin);
}

#[test]
fn issue_twice_fails() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    c.issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"));
    let res = c.try_issue(&subject, &b(&env, 0x02), &symbol_short!("citizen"));
    assert_eq!(res, Err(Ok(Error::AlreadyIssued)));
}

#[test]
fn suspend_reinstate_flow() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    c.issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"));

    c.suspend(&subject);
    assert!(!c.is_eligible(&subject));
    c.reinstate(&subject);
    assert!(c.is_eligible(&subject));

    // revocation is final
    c.revoke(&subject, &b(&env, 0xaa));
    assert_eq!(
        c.try_revoke(&subject, &b(&env, 0xaa)),
        Err(Ok(Error::InvalidTransition))
    );
    assert_eq!(c.try_reinstate(&subject), Err(Ok(Error::InvalidTransition)));
    assert!(!c.is_eligible(&subject));
}

#[test]
fn set_eligible_flag() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    c.issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"));
    c.set_eligible(&subject, &false);
    assert!(!c.is_eligible(&subject));
    c.set_eligible(&subject, &true);
    assert!(c.is_eligible(&subject));
}

#[test]
fn unknown_subject_is_not_eligible() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    assert!(!c.is_eligible(&subject));
    assert_eq!(c.get_credential(&subject), None);
}

#[test]
fn set_admin_rotates_key() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    let new_admin = Address::generate(&env);
    c.set_admin(&new_admin);
    assert_eq!(c.admin(), new_admin);
    // old admin is rejected by auth (traps at auth level)
    env.set_auths(&[]);
    let res = c.try_issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"));
    assert!(res.is_err(), "old admin must be rejected by auth");
}
