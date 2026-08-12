// SPDX-License-Identifier: MIT
// Lets a test import a .sql file as a string (Vite's `?raw` suffix). Used by seed.test.ts to run the
// REAL dev seed against a real D1 rather than a copy that could drift from it.

declare module "*.sql?raw" {
  const content: string;
  export default content;
}
