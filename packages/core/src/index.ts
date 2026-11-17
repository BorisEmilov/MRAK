/**
 * @mrak/core — pure TypeScript game rules. No Phaser, no React, no DOM, no timers.
 */
export {
  PROLOGUE,
  Game,
  CommandSchema,
  type Command,
  type CommandResult,
  type GameDeps,
} from './game';
export { ContentDatabase, ContentError, type ContentInfo } from './content/database';
export {
  evaluateCondition,
  ConditionEvaluator,
  type ConditionContext,
  type DayPhase,
  type QuestStatus,
} from './conditions';
export {
  EffectApplier,
  EffectError,
  MAX_EFFECT_DEPTH,
  type EffectContext,
  type RuleHandler,
  type RuleParams,
  type RuleRegistry,
} from './effects';
export {
  EventBus,
  event,
  type CoreEvent,
  type CoreEventMap,
  type CoreEventType,
  type GameTime,
} from './events';
export {
  createRandom,
  hash32,
  RandomStreams,
  STREAM_NAMES,
  type IRandom,
  type RandomStreamsState,
  type StreamName,
} from './random';
export {
  deserializeSave,
  generationOf,
  MAX_SAVE_BYTES,
  migrateSave,
  MIGRATIONS,
  SAVE_FORMAT,
  SAVE_VERSION,
  SaveError,
  SaveFileSchema,
  SaveTooNewError,
  SaveV1Schema,
  serializeSave,
  type SaveFile,
  type SaveMeta,
} from './save/save';
export { sha256Hex } from './save/checksum';
export {
  MAX_EXPORT_BYTES,
  openSealed,
  packExport,
  SaveCorruptError,
  sealSave,
  unpackExport,
  verifySealed,
  type SealedSave,
} from './save/integrity';
export {
  AUTOSAVE_INTERVAL_MS,
  AUTOSAVE_REASONS,
  AutosavePolicy,
  canManualSave,
  type AutosaveReason,
} from './save/autosave';
export { effectiveStat, getStat, setStat } from './state/stats';
export { WorldStore, type StoreListener } from './state/store';
export {
  cloneState,
  createInitialState,
  deepFreeze,
  emptyZoneState,
  reconcileWithContent,
  WorldStateSchema,
  type AlchemyHint,
  type Attempt,
  type Photo,
  type PhotoSubject,
  type Stack,
  type VillagerState,
  type VillagerStatus,
  type ClockState,
  type NewGameOptions,
  type Snapshot,
  type WorldState,
} from './state/world-state';
export * from './time/calendar';
export * from './world/light';
export * from './world/paths';
export * from './world/exploration';
export {
  elapsedMinutes,
  NOISE_DECAY_PER_MINUTE,
  planExploration,
  WorldRuleError,
} from './world/world-system';
export { applyCalendar, syncChapter } from './time/calendar-system';
export {
  clockMinute,
  evaluatorAt,
  perceivedFear,
  villageRules,
  VillageRuleError,
  weekday,
} from './village/common';
export { contagion, contagionWeight, type ContagionInput } from './village/fear';
export {
  activeRoutine,
  blockAt,
  villagerActivity,
  type VillagerActivity,
  type VillagerActivityKind,
} from './village/routines';
export {
  assignProblem,
  efficiencyOf,
  taskEfficiency,
  traitEfficiency,
  type TaskSlot,
} from './village/tasks';
export { checkpoints, crossesHour, simulateVillage, type Moment } from './village/village-sim';
export { villagerView, type VillagerView } from './village/views';
export { COCK_CROW_MINUTE, GameClock, WITCHING_MINUTE, type GameClockOptions } from './time/clock';
export {
  activeModifiers,
  completeSets,
  displayedObjects,
  equippedGear,
  modifierSources,
  type SourcedModifier,
} from './items/modifiers';
export {
  carryCapacity,
  hoursCrossed,
  itemCount,
  ownsUnique,
  packLoad,
  packSlots,
  type PackLoad,
  type Place,
} from './items/inventory';
export {
  atHome,
  countIn,
  ItemRuleError,
  itemRules,
  potencyOf,
  slotsOf,
  weightOf,
} from './items/rules';
export { gatherStatus, gatherPotency, zoneGathering, type GatherStatus } from './items/gathering';
export {
  hintFor,
  matchRecipe,
  triedBefore,
  visibleRecipes,
  type Ingredient,
} from './items/alchemy';
export { taleOf } from './items/collection';
export { layerMatches, layersFor } from './items/photography';
export {
  categoryProgress,
  CATEGORIES,
  collectionProgress,
  type Category,
  type CategoryProgress,
} from './items/progress';
// guardian progression (docs/systems/progression.md)
export {
  buildPool,
  fateFace,
  outcomeOf,
  readFaces,
  resolveCheck,
  shadowFace,
  successChance,
  type CheckPool,
  type CheckRequest,
  type CheckResult,
  type Difficulty,
  type Omen,
  type PoolPart,
} from './guardian/checks';
export { createGuardian, startingAttributes, type GuardianChoices } from './guardian/creation';
export { collectionChance, inWindow, pactAvailable, remedies, severityFor } from './guardian/debt';
export { blessingProblem, blessingSlots, ownsGear, slotsFor } from './guardian/gear';
export { directorWeight, heirCapacity } from './guardian/journal';
export { awardMilestone, milestonesFor, targetOf } from './guardian/revelation';
export {
  absoluteMinute,
  debtTotal,
  hasTalent,
  isNight,
  ProgressionError,
  progressionRules,
  revelationOf,
  splitCell,
  talentRanks,
} from './guardian/rules';
export {
  attributeCost,
  attributeMax,
  isCallingSkill,
  isReadyToGrow,
  skillCapCost,
  threshold,
} from './guardian/skills';
export {
  affordableTalents,
  isNative,
  previewTalent,
  rowOf,
  talentCost,
  treeAccessCost,
  type NodeStatus,
  type TalentPreview,
} from './guardian/talents';
export { takeoverChance, toneOptions, type ToneOption } from './guardian/virtue';
export {
  compareToPlan,
  powerIndex,
  PROFILES,
  simulate,
  type HourSample,
  type PlanCheck,
  type SimProfile,
} from './guardian/simulate';
export {
  choiceStatus,
  DialogueError,
  requirementMet,
  resolveChoice,
  type ChoiceStatus,
} from './dialogue';
export { advanceQuests, questBlockedBy, startQuest } from './quests';
// fear engine (docs/systems/sanity.md, hysteria.md, event-director.md)
export { crossesFearMoment, fearRules, FearRuleError, nightOf } from './fear/common';
export {
  categoryShares,
  eventWeight,
  pacingAt,
  type DirectedCategory,
  type ExamineRequest,
} from './fear/director';
export {
  GUARDIAN,
  hysteriaOf,
  hysteriaStage,
  mobDifficulty,
  villageSanity,
  type HysteriaStage,
  type MobApproach,
} from './fear/hysteria';
export { perception, sanityRatio, sanityTier, type Perception } from './fear/sanity';
export { simulateNights, type NightSummary, type TensionSample } from './fear/simulate';
export type { DirectorDecision, Occurrence } from './state/world-state';
// possession & exorcism (docs/systems/possession.md, exorcism.md)
export { chooseHost, trueNameProgress, vulnerability } from './occult/possession';
export { preparationBonus, tauntsFor, type Taunt } from './occult/exorcism';
export { corruptionAspect, trustFactor } from './occult/pacts';
export { MysteryError, propositionsOf } from './mysteries';
// night expedition (docs/systems/night-exploration.md, combat.md)
export {
  newAgent,
  perceive,
  stepCreature,
  type CreatureAgent,
  type CreatureMode,
  type Senses,
  type Vec,
} from './night/ai';
export type { NightAction } from './night/night';
export type { Encounter, Person } from './state/world-state';
export { ChronicleError, residents, type Resident } from './chronicle/common';
export {
  buildPreview,
  growthRules,
  population,
  prosperityLevel,
  prosperityScore,
  villageLevel,
  type BuildPreview,
} from './chronicle/growth';
export {
  ageOf,
  heirCandidates,
  legacyOf,
  lineageRules,
  waitingHeir,
  worldBaseline,
} from './chronicle/lineage';
export {
  awardLegacy,
  buyNode,
  emptyProfile,
  grantTitle,
  mergeProfiles,
  nodeBlocked,
  ProfileSchema,
  type Profile,
} from './chronicle/profile';
export {
  chronicleGoals,
  darknessMultiplier,
  endlessRules,
  generateMystery,
  type GoalProgress,
} from './chronicle/endless';
export { inSeasonWindow, seasonalActive } from './chronicle/seasonal';
export {
  AchievementSystem,
  conditionProgress,
  cycleUnlocks,
  recordProfileStats,
  type AchievementProgress,
} from './chronicle/achievements';
