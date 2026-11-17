// Velika — weaver, bride-to-be. Afraid of deep water and of being left alone.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL villager_state(id)
EXTERNAL record_decision(id, choice)

{villager_state("velika") == "sick": Velika is in bed. The loom stands with a half-finished rug, red and black. | Velika is at the loom. She does not stop weaving while you talk.}
"Todor says the wedding will be at Theophany, when the water is blessed. I would rather it were in summer."
* [Ask why she fears the water. #empathy]
    "My brother. In the river, the year of the big snow." She pulls the thread tight.
    "I dream the river calls me by my name. Not my name now. A name from before." #whisper
    ~ set_flag("velika-told-dream")
    -> END
* [Ask where she goes at night. #threat #requires:flag:velika-sleepwalked]
    "I do not go anywhere at night." The shuttle slips from her hand. #shake
    ~ record_decision("velika-night", "pressed")
    -> END
* [Look at the pattern in the rug. #occult]
    The pattern is not one you know. It repeats like a word said over and over.
    "I do not plan it," she says. "My hands know it."
    -> END
* [Promise to be at the wedding. #empathy #virtue:loyalty]
    For the first time she smiles. "Then I will not be alone at the water."
    ~ record_decision("velika-wedding", "promised")
    -> END
