# Story Character Prompt Guide

Use this guide for continuity-sensitive story videos with recurring characters.

It applies to:
- betrayal / cheating stories
- revenge stories
- family drama
- relationship conflict
- workplace drama
- scandal or humiliation arcs
- moral / lesson-driven shorts
- any multi-scene story where the same characters must stay visually consistent

## Goal

The viewer should understand the story at a glance, and the recurring characters should not drift.

The prompt system should do two jobs at once:
- keep character identity stable across scenes
- keep the story beats simple, progressive, and visually legible

## Default Chain

For continuity-sensitive character stories, follow:

`hero portrait -> derived character sheet -> scene start frames -> video`

Do not skip from loose prompts to final video when continuity matters.
Run the asset executor path before rendering clips.

## Workflow Rules

### 1. Approve The Hero Before Anything Else

Do not generate sheets or scene frames until the canonical hero portrait is approved.

### 2. Derive, Do Not Redesign

The sheet must be derived from the approved hero image.
The scene frame must be derived from approved character references.
For the default chain, use the approved reference sheets directly as the scene-image inputs.
Do not auto-mix the scene stage back together with sibling hero portraits unless there is a specific reason.

### 3. Animate The Saved Scene Frame

The video step should animate the saved scene frame, not reinvent the shot from text.

## Character Rules

### 1. Lock The Canonical Hero First

Create one strong hero portrait for each recurring main character.

The hero portrait is the source of truth for:
- subject identity
- face or head geometry
- silhouette
- wardrobe
- palette
- emotional energy

If the hero is weak, everything downstream will drift.

### 2. Use A Clear Hero Prompt Structure

Hero prompts should usually specify:
- subject identity immediately
- material or surface language
- expressive face direction
- body silhouette
- wardrobe with material detail
- signature pose
- shot and camera direction
- lighting
- supporting environment
- mood and palette

### 3. Derive The Sheet From The Hero

The reference sheet is not a redesign.
It is a continuity document generated from the approved hero image.

The sheet should preserve:
- same character
- same proportions
- same wardrobe
- same material finish
- same design facts

Use flat lighting and a plain background.

### 4. Build Scene Frames From Locked References

Scene generation should use saved references, not memory.

For scene frames:
- attach all visible recurring characters
- prefer approved sheets as the default references
- keep the clip's intended character order when attaching references
- keep one dramatic beat per scene
- use strong props when useful

## Story Rules

### 1. One Beat Per Scene

Each clip should have one dramatic job.

Typical order:
- opening
- suspicion
- discovery
- confrontation
- payoff

### 2. Reveal Information Progressively

The viewer should learn the story step by step.

Good:
- setup
- something feels wrong
- proof appears
- confrontation lands
- consequence is visible

Bad:
- everything revealed in clip 1
- confrontation and payoff collapsed together

### 3. Keep Character Count Disciplined

Only include the characters needed for the beat.

Continuity does not mean every character appears in every scene.

### 4. Make The Scandal Visually Legible

If the story depends on betrayal or proof, make the evidence visible.

Useful props:
- phone message
- lipstick mark
- mirror reflection
- photo strip
- suspicious gift
- hospital result
- broken item

The viewer should not need long dialogue to understand the scandal.

### 5. Keep Dialogue Short And Controlled

Prefer:
- one named speaker per clip
- one short line
- literal emotional meaning

Avoid:
- speeches
- overlapping speakers
- dialogue that repeats what the image already shows

For multi-character clips:
- explicitly mark `Speaker:`
- explicitly mark `Silent characters:`
- keep silent characters silent

### 6. Make The Lesson Visible

If the story has a moral payoff, it should appear in the scene structure, not only in the caption.

Examples:
- the cheater is abandoned
- the liar is left alone
- the betrayed partner walks away stronger
- the final frame makes the consequence obvious

For revenge stories:
- show the original wrong clearly
- make the justice mechanism visible before it lands
- let the ending hint at a bigger aftermath or cliffhanger

## Quality Checklist

A story-character prompt system is strong if:
- the recurring characters stay visually consistent
- each scene introduces one clear new turn
- the proof is visible
- the confrontation feels earned
- the ending shows a consequence
- the story still reads with the sound off

## Failures To Avoid

- making the sheet before approving the hero
- generating hero and sheet independently from unrelated prompts
- fresh text-only reinterpretation of recurring characters
- vague wardrobe or silhouette descriptions
- too many characters in every scene
- multiple speaking characters in one clip
- relying on dialogue instead of visible proof

## Rule

For continuity-sensitive story videos, treat character stability and story clarity as one system.
