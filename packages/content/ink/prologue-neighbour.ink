// Prologue: Marija, the neighbour. She is kind on day 1 and rehearses someone else's words by day 3.
// Clue (decades later): a man from Zlatno asked her which house was the herb-woman's.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL has_item(id, qty)
EXTERNAL record_decision(id, choice)

{get_stat("nights-survived") >= 2: -> shut}
{get_stat("nights-survived") >= 1: -> wary}
{get_flag("prologue-neighbour-visited"): -> thanks}
Marija opens the gate before you knock. Her cough sounds like a cart on stones.
"Stana. God sent you. Or somebody did."
* [Give her the basil, steeped in honey. #empathy #requires:item:basil:1]
    She breathes the steam and closes her eyes. "Your mother's remedy. She was a saint, your mother."
    "A man from Zlatno came by yesterday. Fine boots. He asked which house was the herb-woman's."
    "I told him. Was that wrong?"
    ~ set_flag("prologue-neighbour-visited")
    ~ record_decision("prologue-marija", "healed")
    -> END
* [Tell her you have nothing yet.]
    "Then go to the pots by the gardens. Basil. You know better than me."
    -> END

= thanks
"The cough is better already. Go home, Stana. The child needs you."
-> leave

= wary
Marija keeps the gate between you. "My cow gave blood instead of milk this morning."
"I am not saying anything. I am only saying it."
-> leave

= shut
The gate is barred. Behind it, Marija is speaking to someone, low and careful, as if repeating a lesson.
"...barefoot, toward the forest, the night the cattle took sick..." #whisper
She stops when your shadow falls on the gate.
-> leave

= leave
* [Leave.]
    -> END
