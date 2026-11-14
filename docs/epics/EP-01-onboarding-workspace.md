# EP-01 Onboarding & workspace

**Goal:** an agronomist signs up, creates the company, invites the owner, and can open the demo company.
**RFC:** §14. **Tech Design:** §5.1, §14, §15.2. **Design:** 01 Login, 02 Onboarding, 03 EmptyHome.

### S-01.01 Sign up, sign in, sessions

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §16 (Auth) | §14.1 | 01 Login | S-00.03 |

As an agronomist, I want to sign up and sign in with email and password, so that my company's data is private.

**Acceptance criteria**

- Sign up and sign in set a 15-min access cookie (httpOnly, Secure, SameSite=Lax) and a rotating refresh token stored hashed in PostgreSQL.
- Reusing a rotated refresh token revokes its whole family; the user is signed out everywhere.
- Mutating requests without `X-Requested-With` are rejected; auth endpoints are rate-limited.
- Sign in works with Redis stopped.
- The login screen matches 01 in UA and EN, including the "Open public data: NASA, USDA, ESA and others" line.

### S-01.02 Create the company (onboarding)

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §14.2 | §5.1, §15.2 | 02 Onboarding | S-01.01 |

As an agronomist, I want to create my company in two steps, so that the 06:00 check runs in our time zone with our units.

**Acceptance criteria**

- Step 1: company name, time zone (detected from the browser, editable, IANA list), units (ha °C mm / ac °F in), report language (UA / EN).
- Step 2: invite the owner or manager as a Viewer by email, or skip.
- On finish the user is the workspace Owner and lands on the empty home (03).
- A user with no workspace is always routed to `/onboarding`.

### S-01.03 Roles and permission guard

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §14.1 | §14.1 | — | S-01.02 |

As an Owner, I want each member's role enforced on every request, so that Viewers can only read and answer.

**Acceptance criteria**

- A NestJS guard checks the permission for every endpoint from the matrix in Tech Design §14.1.
- API tests per matrix row and role (Owner, Admin, Agronomist, Viewer, report link) for P0 endpoints; the Postman contract collection covers P0 endpoints only in the hackathon (full coverage later, L-21).
- Requests to another workspace return 404, not 403.

### S-01.04 Invite the owner as a Viewer

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P1 | 3 | §14.1 | §5.1, §14 | 02 Onboarding, 15 Reports | S-01.03 |

As an agronomist, I want to invite the company owner as a Viewer, so that they can read the Owner report.

**Acceptance criteria**

- Invitation by email creates a single-use token valid 7 days; accepting it creates the account (or links an existing one) with the Viewer role.
- In the hackathon the invite link is shown to copy; sending email is optional (logged when no mail provider is set).
- Owners and Admins can change a member's role or remove them; the last Owner can't be removed.

### S-01.05 Empty home

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P1 | 2 | §14.2 | §15.2 | 03 EmptyHome | S-01.02, S-00.06 |

As a new agronomist, I want a clear first step, so that I know how to start.

**Acceptance criteria**

- With no fields, `/` shows 03: three steps, **Add your first field** (primary), **Explore the demo company** (secondary) and a greyed example card.
- The first field added switches `/` to the morning brief.

### S-01.06 Explore the demo company

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §14.2 | §5.1, §17 | 03 EmptyHome | S-01.02, S-09.03 |

As a visitor or judge, I want my own copy of the demo company, so that I can try every action without affecting anyone.

**Acceptance criteria**

- **Explore the demo company** copies the seeded template (Prairie Field Co.: fields in Kansas, Nebraska and Logan County, Colorado) into a new workspace marked "Demo", with the user as Owner.
- The copy shares the source cache; creating it takes < 5 s.
- The demo badge is visible on every screen; the user can delete their copy.
