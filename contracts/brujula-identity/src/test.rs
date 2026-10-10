#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    Address, BytesN, ConversionError, Env, InvokeError, Vec,
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
fn admin_rotation_is_timelocked_and_observable() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    let new_admin = Address::generate(&env);

    let eta = c.schedule_admin_rotation(&new_admin);
    assert_eq!(c.admin(), admin, "control must not move at schedule time");
    assert_eq!(c.pending_admin_rotation().unwrap().1, eta);
    assert_state_err(c.try_execute_admin_rotation(), Error::RotationNotReady);

    env.ledger().set_timestamp(eta);
    c.execute_admin_rotation();
    assert_eq!(c.admin(), new_admin);
    assert!(c.pending_admin_rotation().is_none());

    // The old admin can no longer issue credentials.
    env.set_auths(&[]);
    assert!(c
        .try_issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"))
        .is_err());
}

#[test]
fn a_scheduled_rotation_can_be_cancelled() {
    let (env, admin, _subject) = setup();
    let c = deploy(&env, &admin);
    c.schedule_admin_rotation(&Address::generate(&env));
    c.cancel_admin_rotation();
    assert!(c.pending_admin_rotation().is_none());
    assert_eq!(c.admin(), admin);
    // Cancelling with nothing scheduled is an error, not a silent no-op.
    assert_state_err(c.try_cancel_admin_rotation(), Error::NoPendingRotation);
}

#[test]
fn admin_authority_is_n_of_n_over_signers() {
    let (env, admin, subject) = setup();
    let c = deploy(&env, &admin);
    let second = Address::generate(&env);
    let mut set = Vec::new(&env);
    set.push_back(admin.clone());
    set.push_back(second.clone());
    c.set_signers(&set);
    assert_eq!(c.admin_signers().len(), 2);
    assert_eq!(c.admin(), admin);

    // With zero authorised signers, every admin-only call traps.
    env.set_auths(&[]);
    assert!(c
        .try_issue(&subject, &b(&env, 0x01), &symbol_short!("citizen"))
        .is_err());
}

#[test]
fn signer_set_rejects_empty_and_duplicates() {
    let (env, admin, _subject) = setup();
    let c = deploy(&env, &admin);

    let empty = Vec::new(&env);
    assert_state_err(c.try_set_signers(&empty), Error::InvalidSignerSet);

    let mut dup = Vec::new(&env);
    dup.push_back(admin.clone());
    dup.push_back(admin.clone());
    assert_state_err(c.try_set_signers(&dup), Error::InvalidSignerSet);
}

#[test]
fn the_rotation_delay_is_public_and_constant() {
    let (env, admin, _subject) = setup();
    let c = deploy(&env, &admin);
    assert_eq!(c.admin_rotation_delay(), ADMIN_ROTATION_DELAY);
    assert_eq!(c.pending_admin_rotation(), None);
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
    let one = Vec::new(&env);
    assert!(c.try_set_signers(&one).is_err());
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
