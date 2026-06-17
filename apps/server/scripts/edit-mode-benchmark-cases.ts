export interface EditModeBenchmarkCase {
  id: string;
  category: string;
  input: string;
}

export const EDIT_MODE_BENCHMARK_CASES: EditModeBenchmarkCase[] = [
  // ─── filler-heavy ────────────────────────────────────────────────────────

  {
    id: "filler-heavy-1",
    category: "filler-heavy",
    input:
      "um so I was thinking uh we could maybe you know try the new approach for the um the deployment pipeline because like the old one has been uh been giving us a lot of trouble lately",
  },
  {
    id: "filler-heavy-2",
    category: "filler-heavy",
    input:
      "well um I guess the main issue is that like uh we don't really have a clear you know a clear process for handling these um these edge cases and it's been like kind of causing a lot of um friction between the teams",
  },
  {
    id: "filler-heavy-3",
    category: "filler-heavy",
    input:
      "so um the thing is uh like when you look at the metrics you know it's not really that bad um I mean it could be better for sure uh but it's like it's not catastrophic or anything",
  },

  // ─── self-correction ─────────────────────────────────────────────────────

  {
    id: "self-correction-1",
    category: "self-correction",
    input:
      "let's schedule the meeting for wednesday wait no actually thursday afternoon around three pm",
  },
  {
    id: "self-correction-2",
    category: "self-correction",
    input:
      "send the report to marketing actually no to the legal team sorry I mean the compliance team specifically sarah in compliance",
  },
  {
    id: "self-correction-3",
    category: "self-correction",
    input:
      "I think we should use postgres wait no mysql actually you know what let me rephrase let's go with postgres but keep the mysql read replica",
  },
  {
    id: "self-correction-4",
    category: "self-correction",
    input:
      "the budget is around fifty thousand wait sorry sixty actually no let me check my notes it's sixty five thousand for q3",
  },
  {
    id: "self-correction-chain",
    category: "self-correction",
    input:
      "we need to deploy to staging first then to production wait no actually first to dev sorry I mean staging wait scratch that let me start over we need to deploy to dev then staging then production",
  },

  // ─── esl-awkward ─────────────────────────────────────────────────────────

  {
    id: "esl-awkward-1",
    category: "esl-awkward",
    input:
      "the problem is that we are not having enough resources for to complete the project in the timeline that was given to us by the stakeholder",
  },
  {
    id: "esl-awkward-2",
    category: "esl-awkward",
    input:
      "I am thinking that this feature is maybe not so important than the the bug fixes that we are having in the queue right now",
  },
  {
    id: "esl-awkward-3",
    category: "esl-awkward",
    input:
      "we have made the decision for to move forward with the new architecture even though there is some risks that we are not fully understanding yet",
  },
  {
    id: "esl-awkward-4",
    category: "esl-awkward",
    input:
      "the client is asking about when we can deliver and I told them that it is depending on the third party API that is not yet stable in their documentation",
  },

  // ─── run-on-sentences ────────────────────────────────────────────────────

  {
    id: "run-on-1",
    category: "run-on-sentences",
    input:
      "we need to finish the design review by Friday then hand off the specs to engineering and they need to estimate the work before the sprint planning meeting next Tuesday so we're really tight on time here",
  },
  {
    id: "run-on-2",
    category: "run-on-sentences",
    input:
      "the database migration failed again last night and we're not sure why the logs show a timeout on the connection pool but the monitoring dashboard says the server was healthy the whole time so it might be a network issue between the app server and the database cluster",
  },
  {
    id: "run-on-3",
    category: "run-on-sentences",
    input:
      "I talked to the customer success team and they said the onboarding flow is confusing users are dropping off at step three and not coming back and the support tickets have doubled since we launched the new version so we need to prioritize this",
  },
  {
    id: "run-on-4",
    category: "run-on-sentences",
    input:
      "the requirements document is still in draft because legal hasn't signed off yet and we can't start development without their approval but the deadline is next month so if we don't get the sign-off by Wednesday we're going to have to push the timeline out and the client won't be happy about it",
  },

  // ─── list-dictation ──────────────────────────────────────────────────────

  {
    id: "list-dictation-1",
    category: "list-dictation",
    input:
      "for the release we need one update the changelog two run the migration script three notify the support team and four monitor the error logs for the first hour",
  },
  {
    id: "list-dictation-2",
    category: "list-dictation",
    input:
      "here's the agenda for today first we review the sprint progress second we discuss the blockers third we go over the design mockups and finally we assign next sprint tasks",
  },
  {
    id: "list-dictation-3",
    category: "list-dictation",
    input:
      "the bugs we found in QA number one the login screen freezes on mobile number two the search results don't paginate and number three the notification emails are going to spam",
  },
  {
    id: "list-dictation-4",
    category: "list-dictation",
    input:
      "action items from the meeting one sarah will draft the proposal two mike needs to get the cost estimates three I'll set up the stakeholder review and four we all need to read the security audit report before next week",
  },

  // ─── casual-speech ───────────────────────────────────────────────────────

  {
    id: "casual-speech-1",
    category: "casual-speech",
    input:
      "hey just wanted to let you know we're gonna push the demo back a bit cuz we found some issues with the login flow and it's kinda messy right now",
  },
  {
    id: "casual-speech-2",
    category: "casual-speech",
    input:
      "yo can you take a look at this PR when you get a sec it's pretty straightforward just some cleanup stuff nothing crazy",
  },
  {
    id: "casual-speech-3",
    category: "casual-speech",
    input:
      "dude that new library is sick we should totally switch over it's way faster than what we got now and the docs are actually good for once",
  },
  {
    id: "casual-speech-4",
    category: "casual-speech",
    input:
      "so I was like no way that's gonna work in prod and then he showed me the benchmarks and I was like okay fair enough",
  },

  // ─── professional-polish ─────────────────────────────────────────────────

  {
    id: "professional-polish-1",
    category: "professional-polish",
    input:
      "per our conversation I would like to propose that we proceed with the integration however there are some dependencies that we will need to address before we can commit to the timeline",
  },
  {
    id: "professional-polish-2",
    category: "professional-polish",
    input:
      "the quarterly review indicates that we are tracking slightly behind our revenue targets this is primarily due to the delay in the enterprise feature launch which has pushed several deals into the next quarter",
  },
  {
    id: "professional-polish-3",
    category: "professional-polish",
    input:
      "I appreciate the feedback on the proposal and I've made the requested changes to sections three and four however I'd like to discuss the budget allocation before we present the final version to the board",
  },
  {
    id: "professional-polish-4",
    category: "professional-polish",
    input:
      "the cross-functional alignment on this initiative has been strong overall but we are seeing some friction between engineering and product on the prioritization framework and I think this warrants a dedicated sync to get everyone back on the same page",
  },

  // ─── technical-content ───────────────────────────────────────────────────

  {
    id: "technical-content-1",
    category: "technical-content",
    input:
      "the API endpoint is at https://api.example.com/v2/users and you need to pass the authorization header with a bearer token",
  },
  {
    id: "technical-content-2",
    category: "technical-content",
    input:
      "the config file is located at src/config/env.production.ts and the database URL is stored in an environment variable called DATABASE_URL",
  },
  {
    id: "technical-content-3",
    category: "technical-content",
    input:
      "the error is happening at line 147 of auth.service.ts specifically in the validateToken method where it's trying to decode the JWT",
  },
  {
    id: "technical-content-4",
    category: "technical-content",
    input:
      "to run the migration locally you use npm run db:migrate and the seed command is npm run db:seed make sure your .env file has the right connection string postgresql://localhost:5432/mydb",
  },

  // ─── already-clean ───────────────────────────────────────────────────────

  {
    id: "already-clean-1",
    category: "already-clean",
    input:
      "The server responded with a 500 error after the deployment. We reverted to the previous version within five minutes.",
  },
  {
    id: "already-clean-2",
    category: "already-clean",
    input:
      "Could you review the pull request by end of day? It addresses the performance regression we discussed yesterday.",
  },
  {
    id: "already-clean-3",
    category: "already-clean",
    input:
      "I've scheduled the meeting for Thursday at 2 PM in Conference Room B. Please confirm if that works for your team.",
  },

  // ─── verbal-redundancy ───────────────────────────────────────────────────

  {
    id: "verbal-redundancy-1",
    category: "verbal-redundancy",
    input:
      "so basically what I'm trying to say is essentially the core issue here at the end of the day is that we need more test coverage like that's really the main thing that's the bottom line",
  },
  {
    id: "verbal-redundancy-2",
    category: "verbal-redundancy",
    input:
      "the thing about this approach is that it's complicated and by complicated I mean there's a lot of moving parts and when I say a lot of moving parts what I'm really getting at is that the architecture has become quite complex and hard to maintain",
  },
  {
    id: "verbal-redundancy-3",
    category: "verbal-redundancy",
    input:
      "to be honest I think that the timeline is unrealistic and by unrealistic I mean we're not going to hit the deadline if I'm being completely straightforward about it the December date is just not feasible given our current velocity and the scope that's still outstanding",
  },
  {
    id: "verbal-redundancy-4",
    category: "verbal-redundancy",
    input:
      "so in terms of next steps what we should probably do is basically just take a step back and reassess and when I say reassess I mean we need to look at our priorities and figure out what actually matters because right now we're kind of all over the place",
  },

  // ─── combined / complex cases ────────────────────────────────────────────

  {
    id: "combined-filler-esl",
    category: "combined",
    input:
      "um so the thing is that uh we are not having the enough capacity for to handle the um the support tickets that are coming in and like it is you know becoming a quite big problem for the the response times that we are promising to our customers",
  },
  {
    id: "combined-correction-list",
    category: "combined",
    input:
      "okay so for the deployment checklist we um we need first thing backup the database wait no actually first we need to notify the users about the maintenance window then second run the migration then third verify the health checks",
  },
  {
    id: "combined-runon-filler",
    category: "combined",
    input:
      "um I was looking at the analytics dashboard and uh it seems like the conversion rate dropped by about fifteen percent last week and like I'm not totally sure why but you know when I dug into it a bit more it looks like the new checkout flow might be the issue because the drop started right around the time we deployed that change",
  },
  {
    id: "combined-esl-technical",
    category: "combined",
    input:
      "we are needing to update the configuration file at src/config/api.config.ts because the the endpoint URL is having changed from https://old-api.example.com/v1 to https://new-api.example.com/v2 and also we must to update the API key in the environment variables",
  },
];
