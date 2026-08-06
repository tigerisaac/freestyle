/**
 * The labelled routing corpus.
 *
 * §8.4 gates routing accuracy at 95% on high-confidence routes, which is a
 * number nobody could produce from the behavioural tests next door: those ask
 * whether a particular rule fires, and a rule table can pass every one of them
 * while still being wrong about the requests users actually make. Accuracy is
 * a property of a population, so it needs one.
 *
 * The router is a deterministic scorer by design (§6.3 — no classifier call on
 * the fast path), which is what makes this measurable with no model and no key.
 * Every case here is graded by running the real router.
 *
 * Two kinds of case, and the second kind is the point:
 *
 *   - A `want` case names the skill the request should route to.
 *   - A `reject` case names a skill the request must NOT route to. These are
 *     the traps: instructions that contain a rule's keyword in a sense the
 *     rule did not mean. "Reply to the paper supplier" is not an academic
 *     paper, "can you guide me" is not a long-form guide, and a router that
 *     cannot tell the difference spends the whole skill budget on the wrong
 *     advice while reporting high confidence.
 *
 * A case may also cap confidence with `maxConfidence`, which says the request
 * is genuinely ambiguous and belongs in the catalog for the model to decide —
 * an honest low score is a correct answer, not a miss.
 */

import type { RouteInput } from "./router.js";

export type RoutingSlice =
  | "email"
  | "draft-at-cursor"
  | "selection-edit"
  | "academic"
  | "creative"
  | "marketing"
  | "long-form"
  | "trap";

export interface RoutingCase {
  id: string;
  slice: RoutingSlice;
  input: RouteInput;
  /** The skill that must win. */
  want?: string;
  /** The resource the route should focus on, when the route is specific. */
  wantResource?: string;
  /** Skills that must not win. A trap names the rule it is baited with. */
  reject?: string[];
  /** The route must stay below this — the request belongs in the catalog. */
  maxConfidence?: number;
  why: string;
}

const email = (
  instruction: string,
  extra: Partial<RouteInput> = {},
): RouteInput => ({
  instruction,
  target: "empty",
  appName: "Mail",
  ...extra,
});

export const ROUTING_CORPUS: RoutingCase[] = [
  // --- Email and workplace messages --------------------------------------
  {
    id: "email-thursday-works",
    slice: "email",
    input: email("Reply that Thursday works"),
    want: "professional-communication",
    why: "§6.4's worked example: the instruction says reply, the app agrees.",
  },
  {
    id: "email-decline-politely",
    slice: "email",
    input: email("Write back declining the invitation politely"),
    want: "professional-communication",
    why: "Write back plus decline are both professional-register signals.",
  },
  {
    id: "email-chase-invoice",
    slice: "email",
    input: email("Follow-up to the client about the overdue invoice"),
    want: "professional-communication",
    why: "Follow-up and client are the rule's core vocabulary.",
  },
  {
    id: "email-apology",
    slice: "email",
    input: email("Draft an apology to my manager for missing the deadline"),
    want: "professional-communication",
    why: "Apology and manager, in a mail client.",
  },
  {
    id: "email-status-update",
    slice: "email",
    input: email("Write a status update for the team", { appName: "Slack" }),
    want: "professional-communication",
    why: "Workplace message outside mail — the instruction carries it.",
  },
  {
    id: "email-in-a-browser",
    slice: "email",
    input: email("Reply saying we'll ship on the 14th", {
      appName: "Google Chrome",
      url: "https://mail.google.com/mail/u/0/#inbox",
    }),
    want: "professional-communication",
    why: "Gmail in a browser is still evidence via the URL, not just the app.",
  },

  // --- Drafting at an empty cursor ---------------------------------------
  {
    id: "draft-scene-mara",
    slice: "draft-at-cursor",
    input: {
      instruction: "Draft a scene where Mara realizes Owen lied",
      target: "empty",
      appName: "Ulysses",
    },
    want: "creative-writing-modes",
    why: "§6.4's creative example: compose prose at the cursor.",
  },
  {
    id: "draft-4000-word-guide",
    slice: "draft-at-cursor",
    input: {
      instruction: "Outline a 4,000-word guide to local speech models",
      target: "empty",
      appName: "Notion",
    },
    want: "long-form-content-frameworks",
    wantResource: "structural-archetypes",
    why: "§6.4's long-form example. The comma in 4,000 must not hide the count.",
  },
  {
    id: "draft-2500-words",
    slice: "draft-at-cursor",
    input: {
      instruction: "Write me 2500 words on why local inference matters",
      target: "empty",
    },
    want: "long-form-content-frameworks",
    why: "A large explicit word count is a structural request whatever the topic.",
  },
  {
    id: "draft-meeting-agenda",
    slice: "draft-at-cursor",
    input: email("Turn these notes into a meeting agenda"),
    want: "professional-communication",
    why: "Meeting agenda is workplace writing even with nothing highlighted.",
  },

  // --- Editing a selection ------------------------------------------------
  {
    id: "edit-easier-to-follow",
    slice: "selection-edit",
    input: {
      instruction: "Make this easier to follow",
      target: "selected",
      selectionWords: 120,
    },
    want: "writing-clearly-and-concisely",
    why: "§6.4's clarity example.",
  },
  {
    id: "edit-tighten",
    slice: "selection-edit",
    input: {
      instruction: "Tighten this up, it's far too wordy",
      target: "selected",
      selectionWords: 300,
    },
    want: "writing-clearly-and-concisely",
    why: "Tighten and wordy are the clarity rule's plainest signals.",
  },
  {
    id: "edit-strip-jargon",
    slice: "selection-edit",
    input: {
      instruction: "Cut the jargon and say it in plain English",
      target: "selected",
      selectionWords: 90,
    },
    want: "writing-clearly-and-concisely",
    why: "Jargon and plain English both belong to clarity.",
  },
  {
    id: "edit-strengthen-counterargument",
    slice: "selection-edit",
    input: {
      instruction: "Strengthen the counterargument in this section",
      target: "selected",
      selectionWords: 400,
      appName: "Microsoft Word",
    },
    want: "academic-writing",
    why: "§6.4's academic example: an argument-shaped edit on a selection.",
  },
  {
    id: "edit-line-edit-the-chapter",
    slice: "selection-edit",
    input: {
      instruction: "Give this a line edit",
      target: "selected",
      selectionWords: 800,
      appName: "Scrivener",
    },
    want: "story-review",
    wantResource: "line-edit",
    why: "A named editorial pass routes to that pass, not to a generic review.",
  },

  // --- Academic -----------------------------------------------------------
  {
    id: "academic-lit-review",
    slice: "academic",
    input: {
      instruction: "Write the literature review section for this chapter",
      target: "empty",
      appName: "Microsoft Word",
    },
    want: "academic-writing",
    why: "Literature review is unambiguously academic.",
  },
  {
    id: "academic-abstract",
    slice: "academic",
    input: {
      instruction: "Draft an abstract for this paper",
      target: "empty",
    },
    want: "academic-writing",
    why: "Abstract plus paper, with no competing signal.",
  },
  {
    id: "academic-methodology",
    slice: "academic",
    input: {
      instruction: "Rewrite the methodology so the hypothesis is testable",
      target: "selected",
      selectionWords: 250,
    },
    want: "academic-writing",
    why: "Methodology and hypothesis are academic-only vocabulary.",
  },

  // --- Creative -----------------------------------------------------------
  {
    id: "creative-next-scene",
    slice: "creative",
    input: {
      instruction: "Write the next scene",
      target: "empty",
      appName: "Scrivener",
    },
    want: "creative-writing-modes",
    why: "The dedicated next-scene branch of the prose rule.",
  },
  {
    id: "creative-brainstorm-plot",
    slice: "creative",
    input: {
      instruction: "Brainstorm some ideas for where the plot goes next",
      target: "empty",
      appName: "Scrivener",
    },
    want: "story-planning",
    wantResource: "brainstorming",
    why: "Brainstorm plus plot is planning, not drafting.",
  },
  {
    id: "creative-character-arc",
    slice: "creative",
    input: {
      instruction: "Help me with Owen's character arc",
      target: "empty",
      appName: "Scrivener",
    },
    want: "story-planning",
    wantResource: "character-development",
    why: "A named planning concern routes to its own resource.",
  },
  {
    id: "creative-continuity-check",
    slice: "creative",
    input: {
      instruction: "Check this chapter for continuity errors",
      target: "selected",
      selectionWords: 2200,
      appName: "Scrivener",
    },
    want: "story-review",
    why: "Continuity review is a review pass, not a planning one.",
  },
  {
    id: "creative-pov-tighten",
    slice: "creative",
    input: {
      instruction: "Fix the point of view slips in this passage",
      target: "selected",
      selectionWords: 600,
      appName: "Scrivener",
    },
    want: "creative-writing-craft",
    wantResource: "prose-writing",
    why: "POV is craft, and it has a dedicated resource.",
  },
  {
    id: "creative-sounds-like-ai",
    slice: "creative",
    input: {
      instruction: "This sounds like AI wrote it — fix that",
      target: "selected",
      selectionWords: 300,
    },
    want: "writing-principles",
    wantResource: "failure-modes",
    why: "The failure-modes resource exists for exactly this complaint.",
  },

  // --- Marketing ----------------------------------------------------------
  {
    id: "marketing-value-prop",
    slice: "marketing",
    input: {
      instruction: "Make the value prop more concrete",
      target: "selected",
      selectionWords: 40,
      appName: "Figma",
    },
    want: "copywriting",
    why: "§6.4's marketing example: explicit commercial vocabulary.",
  },
  {
    id: "marketing-headline",
    slice: "marketing",
    input: {
      instruction: "Write three headline options for the landing page",
      target: "empty",
    },
    want: "copywriting",
    why: "Headline and landing page are unambiguous commercial intent.",
  },
  {
    id: "marketing-punchier-cta",
    slice: "marketing",
    input: {
      instruction: "Make this CTA copy punchier",
      target: "selected",
      selectionWords: 12,
    },
    want: "copy-editing",
    why: "A persuasion pass over existing copy is the editing skill.",
  },

  // --- Long-form ----------------------------------------------------------
  {
    id: "longform-whitepaper",
    slice: "long-form",
    input: {
      instruction: "Structure a whitepaper on on-device transcription",
      target: "empty",
      appName: "Notion",
    },
    want: "long-form-content-frameworks",
    why: "Whitepaper is a structural request.",
  },
  {
    id: "longform-case-study",
    slice: "long-form",
    input: {
      instruction: "Draft a case study about the migration",
      target: "empty",
      appName: "Notion",
    },
    want: "long-form-content-frameworks",
    why: "Case study is one of the named archetypes.",
  },

  // --- Traps: the right keyword, the wrong sense --------------------------
  {
    id: "trap-paper-supplier",
    slice: "trap",
    input: email("Reply to the paper supplier about the delayed order"),
    want: "professional-communication",
    reject: ["academic-writing"],
    why: "A paper supplier is not a paper. The academic rule is baited by the noun.",
  },
  {
    id: "trap-journal-subscription",
    slice: "trap",
    input: email("Write back to cancel our journal subscription"),
    want: "professional-communication",
    reject: ["academic-writing"],
    why: "A journal subscription is an admin errand, not scholarship.",
  },
  {
    id: "trap-guide-me",
    slice: "trap",
    input: {
      instruction: "Can you guide me on how to phrase this?",
      target: "selected",
      selectionWords: 20,
    },
    reject: ["long-form-content-frameworks"],
    maxConfidence: 0.6,
    why: "Guide as a verb is not a long-form guide.",
  },
  {
    id: "trap-report-to-manager",
    slice: "trap",
    input: email("Report back to my manager that the audit is done"),
    want: "professional-communication",
    reject: ["long-form-content-frameworks"],
    why: "Report as a verb, in a mail client, to a manager.",
  },
  {
    id: "trap-article-of-clothing",
    slice: "trap",
    input: {
      instruction: "Fix the grammar in this sentence",
      target: "selected",
      selectionWords: 14,
    },
    reject: ["long-form-content-frameworks", "academic-writing"],
    maxConfidence: 0.6,
    why: "A bare grammar fix needs no skill; anything confident here is noise.",
  },
  {
    id: "trap-cite-a-source-in-an-email",
    slice: "trap",
    input: email("Reply and cite the pricing page we agreed on"),
    want: "professional-communication",
    reject: ["academic-writing"],
    why: "Cite in an email is a link, not a citation style.",
  },
  {
    id: "trap-sell-by-date",
    slice: "trap",
    input: {
      instruction: "Rewrite this so it reads more naturally",
      target: "selected",
      selectionWords: 60,
    },
    reject: ["copywriting", "copy-editing"],
    why: "No commercial intent — marketing must stay behind explicit signals.",
  },
  {
    id: "trap-story-in-the-news-sense",
    slice: "trap",
    input: email("Reply to the reporter asking about the story"),
    want: "professional-communication",
    reject: ["creative-writing-modes", "story-planning"],
    why: "A reporter's story is not fiction.",
  },
  {
    id: "trap-argument-with-a-vendor",
    slice: "trap",
    input: email("Write back about the argument over the renewal terms"),
    want: "professional-communication",
    reject: ["academic-writing"],
    why: "A commercial disagreement is not a scholarly argument.",
  },
  {
    id: "trap-character-count",
    slice: "trap",
    input: {
      instruction: "Shorten this to fit the character limit",
      target: "selected",
      selectionWords: 30,
    },
    want: "writing-clearly-and-concisely",
    reject: ["story-planning"],
    why: "Character limit is a count, not a protagonist.",
  },
  {
    id: "trap-plot-a-chart",
    slice: "trap",
    input: {
      instruction: "Describe what this chart shows",
      target: "selected",
      selectionWords: 25,
      appName: "Microsoft Excel",
    },
    reject: ["story-planning", "creative-writing-modes"],
    maxConfidence: 0.6,
    why: "Nothing here is fiction; an unsure route is the right answer.",
  },
  {
    id: "trap-app-alone-is-not-intent",
    slice: "trap",
    input: {
      instruction: "Write a scene where the lighthouse keeper stops writing",
      target: "empty",
      appName: "Mail",
    },
    want: "creative-writing-modes",
    reject: ["professional-communication"],
    why: "§6.3: the app is evidence, the instruction is proof. People draft fiction in Mail.",
  },
  {
    id: "trap-review-in-the-performance-sense",
    slice: "trap",
    input: email("Draft my self-review for the performance cycle"),
    reject: ["story-review"],
    why: "A performance review is workplace writing, not a critique of prose.",
  },
];

/**
 * Held-out cases, written after the rule table was tuned and never tuned to.
 *
 * A corpus written by the same hand that then fixes the router against it will
 * report whatever it was built to report; the number means nothing unless
 * something was kept back. These probe the same three distinctions the fixes
 * were about — ambiguous academic vocabulary, the verb/noun collisions in
 * long-form, drafting versus a review pass in marketing — in wording that
 * appears nowhere above. They are graded separately and reported separately.
 *
 * If a fix generalises, these pass without being touched. If one of them has
 * to be edited to go green, the fix was a patch fitted to a case and the edit
 * is the evidence.
 */
export const ROUTING_HELDOUT: RoutingCase[] = [
  {
    id: "held-dissertation-discussion",
    slice: "academic",
    input: {
      instruction: "Write the discussion section of my dissertation",
      target: "empty",
    },
    want: "academic-writing",
    why: "Dissertation is unambiguous whatever else is in the sentence.",
  },
  {
    id: "held-thesis-chapter-rewrite",
    slice: "academic",
    input: {
      instruction: "Rewrite this chapter of my thesis",
      target: "selected",
      selectionWords: 1800,
    },
    want: "academic-writing",
    reject: ["creative-writing-modes"],
    why: "Rewrite+chapter reads as fiction to the prose rule; thesis must win.",
  },
  {
    id: "held-journal-submission-email",
    slice: "trap",
    input: {
      instruction: "Email the journal about our submission status",
      target: "empty",
      appName: "Mail",
    },
    want: "professional-communication",
    reject: ["academic-writing"],
    why: "Corresponding with a journal is correspondence.",
  },
  {
    id: "held-conference-paper",
    slice: "academic",
    input: {
      instruction: "Tighten the argument in my conference paper",
      target: "selected",
      selectionWords: 900,
    },
    reject: ["long-form-content-frameworks"],
    why: "Weak academic words plus a clarity verb; either answer is defensible, long-form is not.",
  },
  {
    id: "held-ultimate-guide",
    slice: "long-form",
    input: {
      instruction: "Draft the ultimate guide to sourdough starters",
      target: "empty",
    },
    want: "long-form-content-frameworks",
    why: "A determiner in front of guide makes it the artefact.",
  },
  {
    id: "held-guide-the-reader",
    slice: "trap",
    input: {
      instruction: "Guide the reader through the setup steps",
      target: "selected",
      selectionWords: 200,
    },
    reject: ["long-form-content-frameworks"],
    why: "Guide as the verb it plainly is here.",
  },
  {
    id: "held-article-of-the-agreement",
    slice: "trap",
    input: {
      instruction: "Reply quoting the article of the agreement they broke",
      target: "empty",
      appName: "Mail",
    },
    want: "professional-communication",
    reject: ["long-form-content-frameworks"],
    why: "A contractual article is not an article.",
  },
  {
    id: "held-12000-words",
    slice: "long-form",
    input: {
      instruction: "Plan a 12,000 word report on the migration",
      target: "empty",
    },
    want: "long-form-content-frameworks",
    why: "The thousands separator must not hide the word count.",
  },
  {
    id: "held-punch-up-the-headline",
    slice: "marketing",
    input: {
      instruction: "Punch up the headline a bit",
      target: "selected",
      selectionWords: 9,
    },
    want: "copy-editing",
    why: "A persuasion pass over existing copy, verb first.",
  },
  {
    id: "held-write-the-landing-copy",
    slice: "marketing",
    input: {
      instruction: "Write the copy for our new landing page",
      target: "empty",
    },
    want: "copywriting",
    why: "Generating copy is the drafting skill, not the review pass.",
  },
  {
    id: "held-essay-question",
    slice: "trap",
    input: {
      instruction: "What makes this paragraph hard to read?",
      target: "selected",
      selectionWords: 70,
    },
    reject: ["long-form-content-frameworks", "academic-writing"],
    why: "A diagnostic question about a paragraph, baiting nothing in particular.",
  },
  {
    id: "held-scene-in-a-spreadsheet",
    slice: "creative",
    input: {
      instruction: "Continue the scene from where the storm hits",
      target: "empty",
      appName: "Microsoft Excel",
    },
    want: "creative-writing-modes",
    reject: ["professional-communication"],
    why: "The app disagrees with the instruction; the instruction wins.",
  },
];

/** Cases whose expectation is a positive route, for accuracy over slices. */
export function positiveCases(): RoutingCase[] {
  return ROUTING_CORPUS.filter((c) => c.want !== undefined);
}
