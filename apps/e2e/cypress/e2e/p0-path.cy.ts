/**
 * The P0 path (S-09.04, PD v2.10 two roles): sign up (becomes Owner) → onboarding (add an agronomist → read the setup link)
 * → sign out → open the setup link, set a password (signed in as the Agronomist) → add field → history → Analyze fields →
 * Accept + Undo + Accept → Ask the owner → assistant "why?" → rotation Save → scouting Send → sign out → sign in as the
 * Owner → /decisions → Approve.
 * The field reuses the Garden City pivot's outline so its sources come from the cache (no multi-minute gather).
 */
const run = Date.now().toString(36);
const email = `e2e-${run}@example.com`;
const agronomistEmail = `e2e-agro-${run}@example.com`;
const password = "correct horse battery";
const agronomistPassword = "another long password";

const signOut = () => {
  cy.get('button[aria-label="Sign out"]').click();
  cy.location("pathname", { timeout: 20_000 }).should("eq", "/login");
};

describe("P0 path", () => {
  it("goes from the owner's sign-up, through the agronomist's work, to the owner's answer", () => {
    // Sign up and create the company.
    cy.visit("/login");
    cy.contains("button", "Create a company").click();
    cy.get('input[name="name"]').type("E2E Owner");
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();

    // No email verification (PD v2.12): the new account signs in straight away and lands on onboarding.
    cy.location("pathname", { timeout: 20_000 }).should("eq", "/onboarding");
    cy.get('input[name="name"]').clear().type(`E2E Farms ${run}`);
    cy.get('button[type="submit"]').click();

    // Step 2: add the agronomist and read the one-time setup link.
    cy.contains("h1", "Add your agronomist");
    cy.get('input[name="agname"]').type("E2E Agronomist");
    cy.get('input[name="email"]').type(agronomistEmail);
    cy.get('button[type="submit"]').click();
    cy.get("input[readonly]", { timeout: 20_000 })
      .invoke("val")
      .then((url) => cy.wrap(new URL(String(url)).pathname).as("setupPath"));
    cy.contains("button", "Continue").click();
    cy.location("pathname").should("eq", "/");
    cy.contains("Owner");
    signOut();

    // The agronomist opens the setup link, chooses a password and is signed in.
    cy.get("@setupPath").then((path) => cy.visit(String(path)));
    cy.get('input[name="password"]').type(agronomistPassword);
    cy.get('button[type="submit"]').click();
    cy.location("pathname", { timeout: 20_000 }).should("eq", "/");
    cy.contains("Agronomist");

    // Add a field by uploading its outline.
    cy.visit("/fields/new");
    cy.get('input[type="file"]').selectFile("cypress/fixtures/pivot-12.geojson", { force: true });
    cy.contains("Full data", { timeout: 20_000 });
    cy.get('input[name="name"]').clear().type("Pivot 12");
    cy.contains("button", "Yes").click();
    cy.contains("button", "Add the field").click();
    cy.location("pathname", { timeout: 20_000 }).should("match", /^\/fields\/[0-9a-f-]{36}$/);

    // History arrives once the gather has finished (cached sources).
    cy.get('ol[aria-label*="2025"]', { timeout: 120_000 }).should("exist");
    cy.location("pathname").then((p) => cy.wrap(p.split("/").pop()).as("fieldId"));

    // Analyze fields from the brief.
    cy.visit("/");
    cy.contains("button", "Analyze fields", { timeout: 20_000 }).click();
    cy.contains(/Done: 1 of 1 fields checked/, { timeout: 90_000 });

    // The rootworm planning item: Accept → Undo → Accept on its page (Accept goes into the plan, not to the owner).
    cy.get("@fieldId").then((id) => cy.visit(`/fields/${id}`));
    cy.contains("a", /rootworm/i, { timeout: 30_000 }).click();
    cy.contains("button", /^Accept$/).click();
    cy.contains("button", "Undo").click();
    cy.contains("button", /^Accept$/, { timeout: 15_000 }).click();
    cy.contains("Accepted into your plan");

    // Ask the owner: a deliberate second step with a note, then the 8 s Undo row.
    cy.contains("button", "Ask the owner", { timeout: 20_000 }).click();
    cy.get("textarea").type("Seed order needs your approval.");
    cy.contains("button", /^Send$/).click();
    cy.contains("Asked the owner");

    // Ask the assistant why.
    cy.contains("a", "Why?").click();
    cy.get('input[placeholder*="Ask about"]', { timeout: 20_000 }).type(
      "Why is there a rootworm risk on this field?{enter}",
    );
    cy.contains(
      /numbers? checked against the models|No numbers in this answer|Assistant unavailable|Showing the data directly/,
      { timeout: 60_000 },
    );

    // Rotation: save to the 2026 plan.
    cy.get("@fieldId").then((id) => cy.visit(`/fields/${id}/rotation`));
    cy.contains("button", /Save to the 2026 plan/, { timeout: 60_000 }).click();
    cy.contains("Saved to the 2026 plan", { timeout: 20_000 });

    // Scouting: start a check from the item, count 5 points, send.
    cy.get("@fieldId").then((id) => cy.visit(`/fields/${id}`));
    cy.contains("a", /rootworm/i, { timeout: 30_000 }).click();
    cy.contains("button", "Start a check").click();
    cy.location("pathname", { timeout: 20_000 }).should("match", /^\/scout\//);
    for (let i = 0; i < 5; i++) {
      cy.get('button[aria-label="More"]').click();
      cy.contains("button", i === 4 ? "Finish the check" : "Next point").click();
    }
    cy.contains("button", "Send to the agronomist").click();
    cy.contains("Check summary", { timeout: 20_000 });
    cy.contains("5%");

    // The agronomist cannot answer decisions: no Approve button on their Decisions page.
    cy.visit("/decisions");
    cy.contains("Waiting for the owner", { timeout: 30_000 });
    cy.contains("button", "Approve").should("not.exist");
    signOut();

    // The owner signs in and answers the asked item.
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
    cy.location("pathname", { timeout: 20_000 }).should("eq", "/");
    cy.visit("/decisions");
    cy.contains("button", "Approve", { timeout: 30_000 }).click();
    cy.contains("You approved on");
  });
});
