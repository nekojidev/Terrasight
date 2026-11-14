/**
 * The P0 path (S-09.04): sign up → onboarding → add field → history → Analyze fields → brief → Accept + Undo + Accept →
 * assistant "why?" → rotation Save to the 2026 plan → scouting Send → Owner report answer via link.
 * The field reuses the demo pivot's outline so its sources come from the cache (no multi-minute gather).
 */
const run = Date.now().toString(36);
const email = `e2e-${run}@example.com`;
const password = "correct horse battery";

describe("P0 path", () => {
  it("goes from sign-up to the owner's answer", () => {
    // Sign up and create the company.
    cy.visit("/login");
    cy.contains("button", "Create a company").click();
    cy.get('input[name="name"]').type("E2E Agronomist");
    cy.get('input[name="email"]').type(email);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
    cy.location("pathname", { timeout: 20_000 }).should("eq", "/onboarding");
    cy.get('input[name="name"]').clear().type(`E2E Farms ${run}`);
    cy.get('button[type="submit"]').click();
    cy.contains("button", "Skip").click();
    cy.location("pathname").should("eq", "/");

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

    // The rootworm planning item: Accept → Undo → Accept on its page.
    cy.get("@fieldId").then((id) => cy.visit(`/fields/${id}`));
    cy.contains("a", /rootworm/i, { timeout: 30_000 }).click();
    cy.contains("button", "Accept and add to the owner report").click();
    cy.contains("button", "Undo").click();
    cy.contains("button", "Accept and add to the owner report", { timeout: 15_000 }).click();
    cy.contains("Added to the owner report");
    cy.contains("In the owner report", { timeout: 20_000 });

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

    // Owner report: create a link and answer through it.
    cy.visit("/reports");
    cy.contains("button", "Create a link").click();
    cy.get("code")
      .invoke("text")
      .then((url) => {
        cy.visit(new URL(url).pathname);
        cy.contains("What to do next");
        cy.contains("button", "Done").click();
        cy.contains("Thanks! Your agronomist got your answer.");
      });
  });
});
