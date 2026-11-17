// Prologue, day 3: the elders under the oak. Not a court: no Ottoman or church law allows this.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL add_stat(id, value)
EXTERNAL record_decision(id, choice)

{get_flag("prologue-judged"): -> after}
{not get_flag("prologue-accused"): -> shade}
The five oldest men of Mrak sit on the roots. The kadi is two days' ride away. Nobody has sent for him.
"We are not a court," says the eldest. "We only ask. Do you know the old words, Stana? The ones for the sick?"
~ set_flag("prologue-judged")
* [Yes. Your mother knew them, and hers. They heal. #virtue:truthfulness]
    ~ record_decision("prologue-trial", "confessed-craft")
    "Words that heal can be said backwards," he says. Nobody asks you whether you ever did.
    -> verdict
* [No. You are a widow who grows basil. #lie]
    ~ record_decision("prologue-trial", "denied-craft")
    "Then whose knot was under the manger?" You have no answer that is not your own hands.
    -> verdict
* [Ask them who taught Petar to look under the manger. #threat]
    ~ record_decision("prologue-trial", "questioned")
    The eldest glances, once, toward the Zlatno road. Then he looks at his boots.
    -> verdict

= verdict
They do not vote. They do not need to. Tomorrow is Enyovden, when herbs are strongest and so is everything else.
"Go to the forest edge at dusk," the eldest says. "Bring the child. Someone should take her."
~ add_stat("sanity", -10)
-> END

= after
The roots are empty. Someone has left a jug of water there, for you. Or for after.
-> leave

= shade
Three old men under the oak, arguing about rain. They stop when you pass, and start again too loud.
-> leave

= leave
* [Leave.]
    -> END
