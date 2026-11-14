/** Every design screen at the design's viewport, for side-by-side review with design/screens (run on demand). */

describe("all screens", () => {
  it("logged out", () => {
    cy.viewport(1440, 920);
    cy.visit("/login");
    cy.wait(1500);
    cy.screenshot("01-login");
  });

  it("logged in", () => {
    cy.env(["E2E_EMAIL", "E2E_PASSWORD", "PIVOT12", "REC"]).then(
      ({ E2E_EMAIL, E2E_PASSWORD, PIVOT12, REC }) => {
        cy.request({
          method: "POST",
          url: "/api/auth/login",
          headers: { "X-Requested-With": "cypress" },
          body: { email: E2E_EMAIL, password: E2E_PASSWORD },
        });
        shoot(PIVOT12 as string, REC as string);
      },
    );
  });
});

function shoot(PIVOT12: string, REC: string) {
  cy.viewport(1440, 920);
  const shots: Array<[string, string]> = [
    ["02-onboarding", "/onboarding"],
    ["04-main", "/"],
    ["07-fields", "/fields"],
    ["08-field", `/fields/${PIVOT12}`],
    ["09-rec", `/recommendations/${REC}`],
    ["10-rotation", `/fields/${PIVOT12}/rotation`],
    ["11-zones", `/fields/${PIVOT12}/zones`],
    ["13-addfield", "/fields/new"],
    ["14-assistant", "/assistant"],
    ["15-reports", "/reports"],
  ];
  for (const [name, path] of shots) {
    cy.visit(path);
    cy.wait(3000);
    cy.document().then((d) => {
      const root = d.documentElement;
      const sw = root.scrollWidth;
      const cw = root.clientWidth;
      let extra = "";
      if (sw > cw) {
        const culprits = Array.from(d.querySelectorAll("body *"))
          .map((el) => ({ el, right: el.getBoundingClientRect().right }))
          .filter((x) => x.right > cw + 1)
          .slice(0, 5)
          .map(
            (x) =>
              `${x.el.tagName.toLowerCase()}.${String(x.el.getAttribute("class") ?? "").slice(0, 80)} right=${Math.round(x.right)}`,
          );
        extra = culprits.map((c) => `  culprit: ${c}\n`).join("");
      }
      cy.writeFile("cypress/screenshots/overflow.txt", `${name} scroll=${sw} client=${cw}\n${extra}`, {
        flag: "a+",
      });
    });
    cy.screenshot(name, { capture: "fullPage" });
  }
  cy.viewport(390, 844);
  cy.visit("/");
  cy.wait(2500);
  cy.screenshot("05-main-mobile");
}
