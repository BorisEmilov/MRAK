// Prologue, day 3: the village names Stana before the church. Naming Dragan is possible; it helps no one.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL add_stat(id, value)
EXTERNAL record_decision(id, choice)

{get_stat("nights-survived") < 2: -> liturgy}
{get_flag("prologue-accused"): -> after}
The whole village is on the porch. Nobody is inside the church. The priest stands in the doorway, between.
Dragan Zlatev is there too, though he is not of Mrak. He speaks gently, as to a child.
"Petar saw her touch the cow, and it died. Marija saw her walk to the forest barefoot. Under the manger: her thread, her knot."
"I do not say she is a witch. I say Mrak should ask her."
~ set_flag("prologue-accused")
~ add_stat("sanity", -10)
* [Say the truth: you were tending a sick child. #empathy #virtue:truthfulness]
    ~ record_decision("prologue-accusation", "denied")
    "With a doll of straw," someone says. "Whispering names." The doll is in your apron. You can feel it, warm.
    -> END
* [Point at Dragan: "Ask him what he bled at the crossroads." #threat #requires:flag:prologue-saw-dragan]
    ~ set_flag("prologue-named-dragan")
    ~ record_decision("prologue-accusation", "named-dragan")
    Silence. Then Dragan laughs, kindly. "You see? She was at the crossroads. At dusk. Alone."
    The priest looks at the altar, then at the floor, and says nothing at all. #whisper
    -> END
* [Say nothing. Let them look at you. #virtue:patience]
    ~ record_decision("prologue-accusation", "silent")
    Your silence is the loudest thing on the porch. It is taken for an answer.
    -> END

= after
They make room around you on the porch, as around a well that has gone bad.
-> leave

= liturgy
The porch is cool and empty. Inside, the priest is counting candles, and loses count when he sees you.
-> leave

= leave
* [Leave.]
    -> END
