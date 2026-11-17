// Krastyo — the miller. Hears the wheel "talking". Fears the aga's men will take the mill.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL has_item(id, qty)
EXTERNAL record_decision(id, choice)

The wheel turns in the black water. The miller wipes flour from his hands before he greets you.
"If you have come for Dimo's dues, I have none. Tell him that."
* [Ask about the voice in the wheel. #occult]
    He listens to the wheel before he answers.
    "It says nothing. Water says nothing. It is only that at night it says it more clearly." #whisper
    ~ set_flag("mill-wheel-heard")
    -> END
* [Ask what he was doing at Velika's house at night. #threat #requires:flag:velika-sleepwalked]
    "Teaching her letters. Old letters. Is that a sin now?" #shake
    ~ record_decision("krastyo-velika", "asked")
    -> END
* [Offer to speak to Dimo for him. #empathy #virtue:compassion]
    "Speak, then. Dimo hears only silver."
    ~ record_decision("krastyo-dues", "helped")
    -> END
* [Say the aga will hear of his debts. #threat #sin:cruelty]
    He goes very pale under the flour.
    ~ record_decision("krastyo-dues", "threatened")
    -> END
