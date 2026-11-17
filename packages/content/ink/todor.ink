// Todor — the young teacher. A sceptic who loves Velika and fears being a fool.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL skill_level(id)
EXTERNAL villager_state(id)
EXTERNAL record_decision(id, choice)

The school is a room behind the church with four benches and one window. Todor is writing.
{villager_state("velika") == "sick": "She is ill and they bring her charms and holy water. What she needs is a doctor from Plovdiv." | "Good day. Have you come to learn your letters, or to tell me about devils?"}
* [Ask him to help keep the clues in order. #empathy]
    "Gladly. Facts, guardian. Write down what you see, not what you fear."
    ~ set_flag("todor-keeps-board")
    -> END
* [Tell him there is something wrong with Velika's rug. #occult #requires:flag:velika-told-dream]
    "It is a pattern. Weavers have patterns." He says it too quickly. #whisper
    -> END
* [Ask about the letter from Bucharest. #threat #requires:flag:todor-letter-found]
    He closes the book over his hands.
    "There is no letter. And if there were, it would be a letter about schools." #shake
    ~ record_decision("todor-letter", "asked")
    -> END
* [Read an old line in his book aloud. #requires:skill:lore:1]
    He looks up, surprised. "You read Church Slavonic. Then you are not only a man of charms."
    -> END
