import { describe, it, expectTypeOf } from "vitest";
import type {
  BuiltinAppearanceId,
  CustomAppearanceId,
  PetAppearanceId,
} from "./types";

describe("PetAppearanceId types", () => {
  it("BuiltinAppearanceId is a literal union of two ids", () => {
    expectTypeOf<BuiltinAppearanceId>().toEqualTypeOf<"lovartPuppy" | "lineDog">();
  });

  it("CustomAppearanceId is a template literal type with custom: prefix", () => {
    expectTypeOf<"custom:abc">().toMatchTypeOf<CustomAppearanceId>();
    expectTypeOf<"custom:">().toMatchTypeOf<CustomAppearanceId>();
    expectTypeOf<"custom:my-cat-2026">().toMatchTypeOf<CustomAppearanceId>();
  });

  it("PetAppearanceId is the union of builtin and custom forms", () => {
    expectTypeOf<PetAppearanceId>().toEqualTypeOf<BuiltinAppearanceId | CustomAppearanceId>();
  });

  it("PetAppearanceId accepts both builtin and custom literal forms", () => {
    expectTypeOf<"lovartPuppy">().toMatchTypeOf<PetAppearanceId>();
    expectTypeOf<"lineDog">().toMatchTypeOf<PetAppearanceId>();
    expectTypeOf<"custom:my-cat">().toMatchTypeOf<PetAppearanceId>();
  });
});