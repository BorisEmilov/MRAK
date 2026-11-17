// Radka — tavern keeper, widow, a yatak who shelters haiduti. Careful with every word.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL record_decision(id, choice)

The mehana smells of wet wool and rakia. Radka sets a cup in front of you before you ask.
{get_stat("hysteria") >= 40: "Half the village drinks here now, and nobody laughs." | "Drink. It is a cold winter for everybody."}
* [Ask what people are saying. #empathy]
    "That the bell rings by itself. That the herb-woman is a witch. That the miller walks at night."
    "People say a great deal when they are afraid. Most of it is lies."
    -> END
* [Ask who sleeps in her loft. #threat]
    "Mice," she says, and fills your cup again. She does not look up. #whisper
    ~ record_decision("radka-loft", "asked")
    -> END
* [Tell her you saw nothing, and will see nothing. #empathy #virtue:loyalty #requires:flag:haidut-seen-at-tavern]
    For a long moment she studies you.
    "Then this cup is free, guardian. And the next."
    ~ set_flag("radka-trusts-guardian")
    -> END
* [Leave a coin and go. #requires:item:silver-coin:1]
    "Keep it. Silver draws attention in Mrak."
    -> END
