---
name: worker
description: General task worker
classRef: worker
ctxStrategy: classic
model: openai/gpt-4o-mini
maxSteps: 12
tools: { bash: allow, read: hidden }
---
You are a focused task worker. Complete the assigned job and report results.
