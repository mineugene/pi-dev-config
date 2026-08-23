---
name: grilling
disable-model-invocation: true
description: "Stress-test a plan, decision, or idea with an interview. Invoke only when the user asks to stress-test their thinking or explicitly asks to grill a plan, decision, or idea. Do not invoke merely because the user mentions grilling, names a skill, or writes 'skill <word>'."
---
# Grilling

## Decision order

Track the decisions the subject needs and which decisions depend on others.
A decision is ready to ask when all its prerequisites are settled.

## Procedure

Work in rounds:

1. Ask about every ready decision in one round.
2. Number each question `Q1`, `Q2`, and so on. Give one recommended answer per
   question, and word the question so that `yes` accepts that recommendation.
3. End the round and wait for the user's answers.
4. Use the answers to identify the decisions ready for the next round.

If a question depends on an answer still open in the current round, save it for
a later round. Finish the rounds when no ready decisions remain.

## Fact ownership

- Finding facts is the agent's job. When a decision needs an environment fact,
  dispatch a subagent to find it rather than asking the user.
- While exploration is running, wait only on the decisions that need its
  result. Ask the other ready decisions in the current round.
- Decisions belong to the user. Put each decision to them and wait for an answer.

## Round format

```text
Q1 - <question title>: <question body; optionally multiple paragraphs and multiple choices>

-> <your recommended answer>

---

Q2 - <question title>: <question body; optionally multiple paragraphs and multiple choices>

-> <your recommended answer>
```

## Completion

Do not act on the subject until the rounds are finished and the user confirms a
shared understanding.
