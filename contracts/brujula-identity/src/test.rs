#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    Address, BytesN, ConversionError, Env, InvokeError,
};

/// `try_*` on a `Result<T, Error>` entrypoint puts the contract's own error in
/// the outer slot (as `Result<Error, InvokeError>`), so it needs this matcher.
fn assert_state_err<T>(
    res: Result<Result<T, ConversionError>, Result<Error, InvokeError>>,
    expected: Error,
) {
    match res {
        Err(Ok(actual)) => assert_eq!(actual, expected),
        Err(Err(_)) => panic!("expected contract error, got host invoke error"),
        Ok(_) => panic!("expected contract error {expected:?}, got success"),
    }
}

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

// ---------------------------------------------------------------------------
// Lifecycle edges that the happy path does not reach.
// ---------------------------------------------------------------------------

#[test]
fn revocation_is_terminal_and_clears_eligibility() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    c.issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"));

    c.revoke(&subject, &b(&env, 0xEE));
    assert!(!c.is_eligible(&subject));
    assert!(!c.get_credential(&subject).unwrap().eligible);

    // A second revoke is an invalid transition, not a silent no-op.
    assert_state_err(
        c.try_revoke(&subject, &b(&env, 0xEE)),
        Error::InvalidTransition,
    );

    // Reinstate must not resurrect a revoked credential: revocation is final.
    assert_state_err(c.try_reinstate(&subject), Error::InvalidTransition);
    assert!(!c.is_eligible(&subject));
}

#[test]
fn eligibility_flag_can_be_toggled_without_touching_status() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    c.issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"));

    c.set_eligible(&subject, &false);
    assert_eq!(c.get_credential(&subject).unwrap().status, STATUS_ACTIVE);
    assert!(!c.is_eligible(&subject));

    c.set_eligible(&subject, &true);
    assert!(c.is_eligible(&subject));
}

#[test]
fn suspend_is_rejected_on_an_already_suspended_credential() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    c.issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"));

    c.suspend(&subject);
    assert_state_err(c.try_suspend(&subject), Error::InvalidTransition);
    // Reinstate restores it, then suspend works again.
    c.reinstate(&subject);
    assert!(c.try_suspend(&subject).is_ok());
}

#[test]
fn unknown_subject_has_no_commitment() {
    let (env, admin, _subject) = setup();
    let c = deploy(&env, &admin);
    let stranger = Address::generate(&env);
    assert_eq!(c.commitment_of(&stranger), None);
    assert!(!c.is_eligible(&stranger));
}

#[test]
fn only_admin_can_mutate_credentials() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    c.issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"));

    // With no auths recorded, every admin-only entrypoint must trap.
    env.set_auths(&[]);
    assert!(c.try_suspend(&subject).is_err());
    assert!(c.try_reinstate(&subject).is_err());
    assert!(c.try_revoke(&subject, &b(&env, 0xEE)).is_err());
    assert!(c.try_set_eligible(&subject, &false).is_err());
    assert!(c.try_set_admin(&Address::generate(&env)).is_err());
}

#[test]
fn credential_timestamps_track_the_ledger() {
    let (env, admin, subject) = setup();
    env.ledger().set_timestamp(1_000);
    let c = deploy(&env, &admin);
    let cred = c.issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"));
    assert_eq!(cred.issued_at, 1_000);
    assert_eq!(cred.updated_at, 1_000);

    env.ledger().set_timestamp(2_000);
    let updated = c.suspend(&subject);
    assert_eq!(updated.updated_at, 2_000);
    // issuance time is immutable
    assert_eq!(updated.issued_at, 1_000);
}
