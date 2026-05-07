/**
 * Pet species lives at the manifest level (see PetAppearanceManifest.species).
 * Items, mini-games, and bubble copy can declare an `appliesTo: PetSpecies[]`
 * filter so adding a new species (e.g. "cat") does not require touching every
 * content table — the runtime simply hides anything that does not apply.
 *
 * v1 ships dog only; cat is reserved here so the type system fails loudly the
 * day a manifest tries an unknown species value.
 */
export type PetSpecies = "dog" | "cat";

export const PET_SPECIES_LIST: readonly PetSpecies[] = ["dog", "cat"] as const;
