# Security Specification & Test-Driven Development (TDD) Blueprint
## Coimbra Nursing Schedule Manager (ESEUC)

This specification defines the rigorous security invariants, the "Dirty Dozen" malicious attacks, and the rules of access to prevent privilege escalation or data tampering inside the ESEUC Horários database.

### 1. Core Data Invariants

1. **Academic Integrity:** A session schedule or UC schedule cannot be created or altered with a start time after its end time.
2. **Identity Lock:** Any teacher or course coordinator can only modify records if they are authenticated with a verified email (`email_verified == true`).
3. **Role Lockdown:** Only validated administrators listed under the `/admins/` path can perform writes on academic installations (classrooms) or core rules.
4. **Temporal Consistency:** Timestamp trackers (`createdAt`, `updatedAt`) must always match the server-side reality via `request.time`.
5. **No Orphan Orphans:** A UC cannot belong to a non-existent course (`cursoId` must reflect a valid Course).

---

### 2. The "Dirty Dozen" Adversarial Payloads
Below are 12 specific payloads designed to breach identity, integrity, and state, all of which will yield `PERMISSION_DENIED` under the fortress ruleset:

#### Attack 1: Self-Elevation to Admin
*   **Vector:** Malicious user attempts to register their profile with an `isAdmin` or `isCoordinator` field set to `true`.
*   **Payload:** `{ "uid": "attacker_id", "name": "Hack", "isAdmin": true }` on `/users/attacker_id` (or `/admins/attacker_id`).
*   **Inviolable Block:** Access control checks `/admins/{adminId}` directly and denies self-insertions.

#### Attack 2: Identity Spoofing (Owner Injection)
*   **Vector:** Creating a version representing an optimized schedule but setting `criadaPor` to the Coordenador Geral's email instead of the caller's authentic UID/email.
*   **Payload:** `{ "id": "v_hack", "nome": "Proposta Fake", "criadaPor": "coordenador@eseuc.pt", "sessoes": [] }`
*   **Inviolable Block:** Require that `incoming().criadaPor == request.auth.token.email`.

#### Attack 3: Denial of Wallet (ID Resource Poisoning)
*   **Vector:** Attacker attempts to register a new classroom but passes a massive 2MB string as the document ID to exhaust space and trigger excessive index storage charges.
*   **Payload:** Attempt writing on `/salas/VERY_LONG_2MB_JUNK_STRING`
*   **Inviolable Block:** Mandatory execution of `isValidId(salaId)` restricting length to `<= 128` characters and alphanumeric formats.

#### Attack 4: Unverified User Manipulation
*   **Vector:** A user registered on Firebase with a spoofed/unverified email tries to alter the corporate availability of active teachers.
*   **Payload:** `{ "maxHorasSemanais": 40 }` by a client with `request.auth.token.email_verified == false`.
*   **Inviolable Block:** Enforce `request.auth.token.email_verified == true` for any write.

#### Attack 5: Ghost Field Injection (Shadow Update)
*   **Vector:** A teacher updating their profile slides in a shadow payload containing a status parameter to overwrite institutional rules.
*   **Payload:** `{ "nome": "Dr. Smith", "bloqueioPosGraduacao": true, "ghostPrivilege": "all-access" }`
*   **Inviolable Block:** Enforce exact key matches on updates using `affectedKeys().hasOnly(['nome', 'email', 'departamento', 'maxHorasSemanais', 'disponibilidade', 'bloqueioPosGraduacao'])`.

#### Attack 6: Temporal Retrofitting (Client Timestamp Spoofing)
*   **Vector:** Overwriting a version creation date to look like it was submitted months ago to bypass audit deadlines.
*   **Payload:** `{ "id": "v_old", "criadaEm": "1999-01-01T00:00:00Z" }`
*   **Inviolable Block:** Mandatory assertion: `incoming().criadaEm == request.time`.

#### Attack 7: Course Deletion by Contributor
*   **Vector:** An authenticated user who is not an administrator tries to delete an entire course catalog (`/cursos/c1`).
*   **Payload:** `DELETE` action on `/cursos/c1` requested by a normal teacher.
*   **Inviolable Block:** Delete permissions are strictly gated behind `isAdmin()`.

#### Attack 8: Overlapping Slots Bypass
*   **Vector:** Forcing a schedule update with a negative hour duration or invalid periods to crash the visualization renderer.
*   **Payload:** `{ "horaInicio": "16:00", "horaFim": "08:00" }`
*   **Inviolable Block:** Invariant schema checks inside helper `isValidSessao()`.

#### Attack 9: Global Unrestricted Scraper (Query Trust Breach)
*   **Vector:** Malicious script queries `/versoes` without any scope constraints to obtain all historic versions.
*   **Payload:** `getDocs(collection('versoes'))`
*   **Inviolable Block:** Security rules require querying specifically matched user profiles or semesters, forbidding blanket listing without rule checks.

#### Attack 10: State Shortcut (Direct Conflict Resolution Override)
*   **Vector:** Setting a solver outcome to "Optimal" when it was actually rejected or contains massive overlaps.
*   **Payload:** `{ "status": "Concluído", "score": 100, "conflitosContidos": 999 }`
*   **Inviolable Block:** Schema validator triggers mismatch alerts if constraints do not balance.

#### Attack 11: Value Poisoning (Invalid ECTS types)
*   **Vector:** Updating a UC's ECTS or weekly hours to negative numbers or decimal values to trigger server division-by-zero or math bugs.
*   **Payload:** `{ "ects": -55, "cargaHorariaTeorica": 9999 }`
*   **Inviolable Block:** Explicit boundary assertions `<= 30` ECTS and `<= 40` hours.

#### Attack 12: Orphaned UC Reference Creation
*   **Vector:** Creating a new UC with a random, non-existent `cursoId` to trigger null errors.
*   **Payload:** `{ "id": "uc_orphan", "cursoId": "non_existent_course_abc" }`
*   **Inviolable Block:** Validate parent existence using `exists(/databases/$(database)/documents/cursos/$(incoming().cursoId))` on creation.

---

### 3. Test Runner Design Outline (firestore.rules.test.ts)

The validation script will load the local emulator config and iterate over each of the Dirty Dozen, verifying:
*   `assertFails` on all spoofing, elevation, and value poisoning payloads.
*   `assertSucceeds` on legitimate teacher schedule entries and verified coordinator actions.
