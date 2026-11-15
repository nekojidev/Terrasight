/** Visual check of the main screens for a real account (run on demand: --env E2E_EMAIL=…,E2E_PASSWORD=…). */
describe("screens", () => {
  beforeEach(() => {
    cy.env(["E2E_EMAIL", "E2E_PASSWORD"]).then(({ E2E_EMAIL, E2E_PASSWORD }) =>
      cy.request({
        method: "POST",
        url: "/api/auth/login",
        headers: { "X-Requested-With": "cypress" },
        body: { email: E2E_EMAIL, password: E2E_PASSWORD },
      }),
    );
  });
  it("captures the main screens", () => {
    for (const path of ["/", "/fields", "/rotation", "/decisions"]) {
      cy.visit(path);
      cy.wait(2500);
      cy.screenshot(`desktop${path.replace(/\//g, "_") || "_home"}`, { capture: "fullPage" });
    }
    cy.visit("/fields");
    cy.contains("a", "Pivot 12").click();
    cy.wait(2000);
    cy.location("pathname").then((p) => {
      cy.visit(`${p}/zones`);
      cy.wait(2000);
      cy.screenshot("desktop_zones", { capture: "fullPage" });
    });
    cy.viewport(390, 844);
    cy.visit("/");
    cy.wait(2500);
    cy.screenshot("phone_home", { capture: "fullPage" });
    cy.contains("button", "Ask the owner").click();
    cy.wait(500);
    cy.screenshot("phone_sheet");
  });
});
