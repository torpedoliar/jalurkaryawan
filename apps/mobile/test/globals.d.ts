// ponytail: mock-api sources compile inside the mobile program, but RN's
// global FormData has no .get — widen it so system.ts typechecks (no DOM lib on RN).
interface FormData {
  get(name: string): any;
}
