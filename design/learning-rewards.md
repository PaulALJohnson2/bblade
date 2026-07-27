# Learning rewards — research notes and design rules

Working notes behind the contribution-scoring layer (`src/utils/learningScore.js`,
`src/components/LearningReward.jsx`). Learning is the platform's USP, so the
mechanics that encourage humans to teach it are product surface, not decoration.

This file is where we bank what we learn. Add to it; don't let it go stale.

Last reviewed: July 2026.

---

## 1. Dopamine responds to surprise, not reward

Schultz's recordings found dopamine neurons fire on the *difference* between
predicted and actual outcome — above baseline for better than expected, flat
for **fully predicted rewards**, and depressed for worse. The system is a
surprise detector, not a pleasure meter. It's the same update rule as temporal
difference learning in ML, arrived at independently.

**What this means here.** A fixed "+4 per supplier code" stops registering
almost immediately, because it becomes fully predicted. Habituation isn't a
failure of the reward, it's the mechanism working as designed.

**Rules**
- Reward magnitude must track *information gained*, so it naturally varies.
  Already true: the 50th Tradeteam note earns near zero.
- The reward moment must carry something the user couldn't predict. Ours is the
  changing prediction line ("next note: 15 lines instantly"), not the number.
- Never inflate to compensate for habituation. That's how a score becomes an
  activity meter.

## 2. Feedback and money pull in opposite directions

Deci, Koestner & Ryan's meta-analysis of 128 experiments found the two split
cleanly, and the signs are opposite:

| | effect on intrinsic motivation |
|---|---|
| Tangible rewards | **d ≈ −0.34** — undermine, most on interesting tasks |
| Positive feedback | **d ≈ +0.33** free-choice, **+0.31** self-reported interest |

The mediator is how the event is *perceived*: something that reads as
controlling your behaviour undermines; something that signifies your competence
enhances. Same event, opposite outcome, depending on framing.

Reward *timing and contingency* matter too. Expected, task-contingent rewards
carry the risk; unexpected rewards given after the fact do not undermine in the
same way.

The asymmetry is what makes tangible rewards expensive: withdraw one people
have come to expect and behaviour can settle *below* where it started.

**Rules**
- **What the platform gives is feedback — the enhancing kind.** That's the
  entire reward loop we build, and it's free of the crowding-out risk.
- Every reward moment must signify competence, never control. "Here's what it
  can now do" beats "well done" and beats a target being hit.
- Where a venue adds money, advise: unexpected over announced, occasional over
  standing, recognition over rate. See §8.

## 8. Our position: we measure and give feedback; the venue decides on reward

BBlade does not pay anyone. The platform surfaces contribution and gives
positive feedback in-product; whether that turns into money is the venue's call.

That lowers our liability and raises our duty of care, because **we are the
measure designer handing a number to someone who hasn't read Holmström &
Milgrom.** A landlord shown "Oli: 340 this month" will reasonably read it as a
basis for reward. So the guidance has to travel *with* the number, on the
screen, not live in a document nobody opens.

**Rules for anything we show a manager**
- Call it **contribution**, never performance. It measures what someone taught
  the system, which is a slice of their job and not the important slice.
- State inline what it does not capture — service, care over counting, honest
  reporting, everything unmeasurable.
- **No default ranking.** A sorted table hands them the decision. Show
  contributions; don't stack-rank colleagues.
- Ship the advice: unexpected over announced; occasional over standing;
  team-wide over individual; recognition over cash. All of it evidence-backed,
  all of it cheaper than a bonus scheme.
- Say plainly that rising contribution alongside rising stock variance means the
  number is being served instead of the venue.

## 3. Goodhart's law, and the multitask problem (the serious one)

When a measure becomes a target it stops being a good measure. Worse, Holmström
& Milgrom (1991) showed that strong incentives on *easily measured* outputs
cause rational agents to **underinvest in harder-to-observe work**. Wells Fargo
is the canonical failure: aggressive targets tied to pay produced years of
falsified records.

**This is the biggest live risk in our design.** Scanning notes and confirming
codes are trivially measurable. Counting carefully, reporting wastage honestly,
rotating stock, keeping the cellar tidy — are not. Pay only for the first set
and you quietly bid attention away from the second.

**Rules**
- Nothing that could conceal loss ever scores. Wastage logging is excluded for
  exactly this reason, and that exclusion is load-bearing — don't "improve" it.
- Every scoring fact must be **externally corroborated** by a document or a
  count, never assertable by one person alone.
- Watch for volume without quality: rising scores alongside rising variance is
  the tell that the metric is being served instead of the venue.
- Prefer venue-level thresholds over individual ranking when money is attached.

## 4. Goal gradient — and the reset after the reward

Kivetz, Urminsky & Zheng (2006): effort accelerates as a goal nears (the coffee
card effect), and **pace collapses once the reward is claimed** — the pull is
tied to an *open* goal. The endowed progress effect adds that perceived
progress drives this, not actual progress.

**Rules**
- There must always be a visible next gate. Our level card always names the
  next unlock and the distance to it.
- **Gap:** level 5 (Predicted) is terminal. Something has to open after it —
  most likely a maintenance goal (keep counts recent, keep suppliers scanned)
  rather than an invented tier.
- Don't fake progress to exploit endowed progress. It works, and it's a lie.

## 5. Points, badges and leaderboards fail in the workplace

Gartner's much-quoted prediction was that 80% of enterprise gamification would
fail within two years, and the common diagnosis is the "PBL fallacy" — bolting
points onto mandatory work while ignoring behavioural design. The specific
failure modes reported: leaderboards that make most of the team feel like
losers; badges nobody cares about after week two; adults feeling managed by a
children's app.

**Rules**
- No badges. No cross-venue leaderboards. No mandatory fun.
- The reward is the **capability that turns on**, not the token. Our levels each
  unlock a real feature; a level that unlocks nothing shouldn't exist.
- Tone: professional with a lift. A landlord with a bar to run finds confetti
  patronising.

## 6. Self-determination theory: competence, autonomy, relatedness

Gamification can *either* support or thwart intrinsic motivation depending on
whether it satisfies these needs. Meta-analytic work finds gamification tends to
help autonomy and relatedness more than competence. Nicholson's "meaningful
gamification" argues the difference is whether the mechanics are made
*informative* to the user rather than merely scored.

**Rules**
- Competence: tell people what the system can now do that it couldn't before.
  That's information, not praise.
- Autonomy: never gate real work behind the game. Scoring observes; it must
  never coerce.
- Relatedness: credit by name in the moment ("nice one, Oli"), but never rank
  colleagues against each other.

## 7. Workplace software is not a consumer app

Staff can't uninstall it. Persuasive mechanics carry more force when the user is
paid to be there, so the ethical bar is higher, not lower. Once a number
influences pay it is an employment record: it must be itemised, inspectable by
the person it describes, and correctable.

---

## Where the current build stands

| Principle | Status |
|---|---|
| Reward tracks information gained | ✅ diminishing returns by design |
| Surprise, not fixed payout | ⚠️ partial — prediction line varies, values don't |
| No badges / leaderboards | ✅ |
| Levels unlock real capability | ✅ five gates, each a real feature |
| Always an open next goal | ⚠️ level 5 is terminal |
| Corroboration required | ✅ items need a note, mapping or count |
| Nothing that can mask loss | ✅ wastage excluded |
| Self-farming closed | ✅ correction needs a changed target + another owner |
| Itemised and contestable | ✅ `scoreByPerson` returns the facts |
| Feedback framed as competence | ✅ the moment names the capability gained |
| Manager view carries its caveats | ❌ not built yet |
| No default ranking of staff | ❌ `scoreByPerson` currently sorts by earned |

## Open questions

1. **What guidance ships beside the manager's contribution view?** We don't pay
   anyone, but we hand over the number that prompts payment, so the advice in
   §8 needs to be on that screen rather than in this file.
2. **What opens after level 5?** A maintenance goal, or the gradient dies.
3. **How do we detect Goodhart drift?** Proposal: watch contribution score
   against stock variance. Score up and variance up together is the alarm.
4. **Should the venue score be visible to staff, or only their own?** Shared
   goals support relatedness; visible individual comparison doesn't.
5. **Does `scoreByPerson` keep sorting by earned?** It's a ranking in all but
   name. Fine as an API; wrong as a default view.

## Sources

- [Schultz, *Dopamine reward prediction error coding*](https://www.tandfonline.com/doi/full/10.31887/DCNS.2016.18.1/wschultz)
- [BrainFacts — Discovering dopamine's role in reward prediction error](https://www.brainfacts.org/brain-anatomy-and-function/genes-and-molecules/2021/discovering-dopamines-role-in-reward-prediction-error-122121)
- [Deci, Koestner & Ryan — meta-analytic review of extrinsic rewards on intrinsic motivation](https://depts.washington.edu/techdocs/papers/deciExtrinsicRewardsAndIntrinsicMotivation99.pdf)
- [Overjustification effect (overview)](https://en.wikipedia.org/wiki/Overjustification_effect)
- [Deci, Koestner & Ryan (2001) — *Extrinsic Rewards and Intrinsic Motivation in Education: Reconsidered Once Again*](https://journals.sagepub.com/doi/10.3102/00346543071001001)
- [Kivetz, Urminsky & Zheng — *The Goal-Gradient Hypothesis Resurrected*](https://www.columbia.edu/~rk566/Session4/Goal-Gradient_Illusionary_Goal_Progress.pdf)
- [Yu-kai Chou — the points, badges and leaderboards fallacy](https://yukaichou.com/gamification-study/points-badges-and-leaderboards-the-gamification-fallacy/)
- [SHRM — gamification at work can go very wrong](https://www.shrm.org/topics-tools/news/technology/careful-gamification-work-can-go-wrong)
- [Nicholson — *A User-Centered Theoretical Framework for Meaningful Gamification*](https://www.semanticscholar.org/paper/A-User-Centered-Theoretical-Framework-for-Nicholson/df1315c007ecebb6d195e0844df4aa41b820a699)
- [Sailer et al. — how gamification motivates: game design elements and psychological need satisfaction](https://www.sciencedirect.com/science/article/pii/S074756321630855X)
- [Psych Safety — Goodhart's law, Campbell's law and the cobra effect](https://psychsafety.com/goodharts-law-campbells-law-and-the-cobra-effect/)
