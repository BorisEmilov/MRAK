// Prologue: the crossroads at dusk. Stana sees Dragan Zlatev come back; she does not see from what.
// Clue: the coin he drops bears a key with three teeth (the cipher of his ledger, 1834+).
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL record_decision(id, choice)

{get_stat("nights-survived") < 1: -> herbs}
{get_flag("prologue-saw-dragan"): -> after}
Wormwood grows thickest where three roads meet. You are cutting it when the light goes copper.
A man comes up the Zlatno road, walking fast, his sleeve dark and wet to the elbow.
Dragan Zlatev. He sees you. For a moment he does not look like a rich man. He looks like a boy caught at a well.
"Herb-woman," he says, and smiles, and keeps walking.
~ set_flag("prologue-saw-dragan")
* [Call after him: "Is that blood on your sleeve?" #threat #virtue:courage]
    ~ record_decision("prologue-dragan", "asked")
    "Wine," he says without turning. "From the feast at Zlatno. Go home, Stana. It is getting dark."
    -> coin
* [Lower your eyes and let him pass. #virtue:humility]
    ~ record_decision("prologue-dragan", "silent")
    -> coin

= coin
Where he passed, a coin lies on the stone. Gold, new, still warm.
On its face, where a sultan's tughra should be, someone has scratched a key with three teeth.
~ set_flag("prologue-coin-mark")
* [Leave it on the stone.]
    You leave it. When you look back from the bend in the road, it is gone.
    -> END
* [Throw it into the wormwood. #occult]
    It does not make a sound when it lands.
    -> END

= after
The stone is just a stone. Someone has swept the dust around it into a perfect circle.
-> leave

= herbs
Wormwood and yarrow by the stone. Nobody comes this way after dark if they can help it.
-> leave

= leave
* [Leave.]
    -> END
