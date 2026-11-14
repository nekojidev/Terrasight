/** Add field (design 13): press-and-drag traces the outline without panning the map; clicks add vertices. */
describe("draw a field", () => {
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

  const canvas = () => cy.get(".maplibregl-canvas");
  const mouse = (type: string, x: number, y: number) =>
    canvas().trigger(type, x, y, {
      eventConstructor: "MouseEvent",
      button: 0,
      buttons: type === "mouseup" ? 0 : 1,
      force: true,
    });

  it("traces an outline by dragging", () => {
    cy.visit("/fields/new");
    canvas().should("be.visible");
    cy.wait(1500);
    const path: Array<[number, number]> = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * 2 * Math.PI;
      path.push([300 + 120 * Math.cos(a), 260 + 120 * Math.sin(a)]);
    }
    mouse("mousedown", ...path[0]!);
    for (const p of path.slice(1)) mouse("mousemove", ...p);
    mouse("mouseup", ...path[path.length - 1]!);
    cy.contains("press and drag").should("not.exist"); // outline closed
    cy.wait(1500);
    cy.screenshot("draw_traced");
  });

  it("adds vertices by clicking and finishes with a double-click", () => {
    cy.visit("/fields/new");
    canvas().should("be.visible");
    cy.wait(1500);
    for (const [x, y] of [
      [200, 200],
      [400, 200],
      [400, 380],
    ] as const) {
      mouse("mousedown", x, y);
      mouse("mouseup", x, y);
    }
    mouse("mousedown", 200, 380);
    mouse("mouseup", 200, 380);
    canvas().trigger("dblclick", 200, 380, { eventConstructor: "MouseEvent", force: true });
    cy.contains("press and drag").should("not.exist");
    cy.wait(1500);
    cy.screenshot("draw_clicked");
  });
});
