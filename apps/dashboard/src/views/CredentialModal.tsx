import { useState } from "react";

export default function CredentialModal() {
  const [did, setDid] = useState("did:civic:884a92c301bf890c");
  const [verified, setVerified] = useState(false);

  const handleConfirm = () => {
    setVerified(true);
    alert("Credencial confirmada con éxito. Redirigiendo a boleta digital...");
  };

  return (
    <div className="modal-backdrop" id="credential-modal">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <div className="modal-head-left">
            <svg className="modal-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
            </svg>
            <h2 className="modal-title" id="modal-title">Validar Credencial Ciudadana</h2>
          </div>
          <button className="modal-close" onClick={() => document.getElementById("credential-modal")?.classList.add("hidden")} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <p className="modal-desc">
          Ingresa tu identificador DID o carga tu archivo de clave ciudadana para
          comprobar de inmediato tu habilitación en los comicios comunales activos.
        </p>

        <div className="modal-field">
          <label className="modal-field-label" htmlFor="did-input">IDENTIFICADOR CÍVICO (DID):</label>
          <input
            id="did-input"
            className="modal-input"
            type="text"
            value={did}
            onChange={(e) => setDid(e.target.value)}
            placeholder="did:civic:884a92c301bf890c"
            autoComplete="off"
          />
        </div>

        <div className="modal-status">
          <div className="status-row">
            <span className="status-key">ESTADO EN PADRÓN:</span>
            <span className={`status-value ${verified ? "status-ok" : "status-pending"}`}>
              {verified ? "[HABILITADO PARA VOTAR]" : "[ESPERANDO CONFIRMACIÓN]"}
            </span>
          </div>
          <div className="status-row">
            <span className="status-key">DISTRITO ASIGNADO:</span>
            <span className="status-value">DISTRITO 04 - NORTE</span>
          </div>
          <div className="status-row">
            <span className="status-key">CONSULTAS PENDIENTES:</span>
            <span className="status-value">3 INICIATIVAS</span>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => document.getElementById("credential-modal")?.classList.add("hidden")}>
            Cerrar
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={verified}
          >
            {verified ? "✓ Confirmado" : "Confirmar y Acceder a Boletas"}
          </button>
        </div>
      </div>
    </div>
  );
}
