// Petko — sexton and gravedigger. Afraid he rang the 3:33 bell in his sleep. Key witness.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL villager_state(id)
EXTERNAL record_decision(id, choice)

Petko leans on his spade. There is earth under his nails and in the creases of his face.
* [Ask about the bell at night. #empathy #requires:flag:bell-rang-333]
    "Three times. I counted. And I was in my chair, guardian, I swear on my mother."
    "Unless I was not. Unless I walk, like the old people say the dead walk." #whisper
    -> END
* [Ask what he saw at the crossroads. #threat #requires:flag:bell-rang-333]
    "Nothing. A man. Somebody in a good coat, at midnight. I did not see his face." #shake
    ~ set_flag("petko-saw-crossroads")
    ~ record_decision("petko-crossroads", "asked")
    -> END
* [Ask about the empty graves of twenty-nine. #occult #requires:flag:petko-confessed-graves]
    He puts down the spade.
    "God forgive me. They paid in silver, and the coffins were light." #whisper
    -> END
* [Help him with the digging for an hour. #empathy #virtue:humility]
    You dig in silence. The ground is hard and the work is honest.
    "You have good hands for a guardian," Petko says at last.
    ~ record_decision("petko-dig", "helped")
    -> END
