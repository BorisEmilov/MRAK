// Prologue (docs/lore/prologue.md): Stana's house. Day 1 tends Kalina (inventory + choices
// tutorial); day 2 opens on mud no one explains; day 3 the house is already empty of friends.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL add_stat(id, value)
EXTERNAL has_item(id, qty)
EXTERNAL record_decision(id, choice)

{get_stat("nights-survived") >= 2: -> third}
{get_stat("nights-survived") >= 1: -> second}
{get_flag("prologue-doll-sewn"): -> rested}
Kalina is too hot and too quiet in her cradle. The straw mattress smells of sweat and thyme.
Your mother taught you the old way: a doll of rag and straw takes the sickness, if it knows the child's name.
* [Sew the doll with red thread. #occult #requires:item:red-thread:1]
    You bind the waist three times, the way it must be done. You whisper "Kalina" into the straw.
    The doll is warm when you lay it beside her. Warmer than your hands. #whisper
    ~ set_flag("prologue-doll-sewn")
    ~ record_decision("prologue-doll", "sewn")
    -> END
* [Pray over her instead. #empathy]
    You say the Lord's prayer twice. Kalina coughs and does not wake.
    The doll would be quicker. Everyone in Mrak knows it, even the ones who call it sin.
    -> END

= rested
Kalina sleeps. The doll lies against her cheek, its red belt dark in the lamplight.
-> leave

= second
{get_flag("prologue-woke-forest"): -> rested}
You wake on the floor by the door, not in your bed. Your feet are black with forest mud.
There is a pine needle in your hair, and the taste of milk in your mouth. You have no milk.
Kalina's fever is gone. The doll is cold now.
~ set_flag("prologue-woke-forest")
~ add_stat("sanity", -5)
* [Wash your feet before anyone sees. #lie]
    ~ record_decision("prologue-mud", "hidden")
    The water in the basin turns the colour of the Samodivi Forest.
    -> END
* [Leave it. You have done nothing wrong. #empathy]
    ~ record_decision("prologue-mud", "left")
    Through the window, Marija is watching your door. She looks away too slowly.
    -> END

= third
{get_flag("prologue-complete"): -> END}
Someone has painted a cross in tar on your door during the night. The paint is still wet.
Kalina laughs at the shadow of the lamp. She is the only one in Mrak who laughs today.
-> leave

= leave
* [Leave.]
    -> END
