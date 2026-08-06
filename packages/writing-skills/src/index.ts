/**
 * `@freestyle-voice/writing-skills` — vendored third-party writing expertise,
 * as pure data.
 *
 * Consumed identically by the desktop's local/BYOK server and by Freestyle
 * Cloud, which is the point: the two must assemble the same prompt from the
 * same bytes, and `BUNDLE_HASH` is what lets CI prove they did.
 *
 * Nothing here executes third-party content. See `specs/remix-writing-skills.md`
 * §6.7 for the trust boundary and `scripts/import-skills.ts` for where it is
 * enforced.
 */

export {
  buildCatalog,
  catalogEntry,
  getSkill,
  renderCatalog,
  SKILL_LIST,
  skillsInCategory,
} from "./catalog.js";
export {
  type Activation,
  type ActivationRequest,
  activateSkill,
  BUNDLE_HASH,
} from "./loader.js";
export {
  PRE_ACTIVATE_CONFIDENCE,
  type RouteInput,
  routeWritingSkill,
} from "./router.js";
export type {
  CatalogEntry,
  RouteDecision,
  SkillCategory,
  SkillProvenance,
  SkillResource,
  SkillSection,
  WritingSkill,
} from "./types.js";
