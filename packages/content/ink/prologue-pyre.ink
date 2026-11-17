// Prologue end: Enyovden 1779 at the forest edge. Stana gives Kalina to Ivan Svetlev (the
// guardian bloodline). The doll passes on with the child: the cursed object that carries the
// chronicle to 1834. The ending never says whether Stana was a witch.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL record_decision(id, choice)

{get_flag("prologue-complete"): -> END}
{not get_flag("prologue-judged"): -> edge}
The whole village has come, and has brought wood. Nobody carries a weapon. Nobody needs to.
A young man holds the torch as if it were heavy. Ivan Svetlev, of the night watch. He cannot look at you.
Kalina pulls at the doll's red belt and laughs.
* [Give Kalina to Ivan. "Raise her far from this." #empathy #virtue:mercy]
    ~ set_flag("prologue-kalina-given")
    ~ record_decision("prologue-pyre", "kalina-to-ivan")
    He takes her in the arm that does not hold the fire. The doll goes with her.
    "I will," he says. It is the only promise anyone makes you in Mrak.
    -> fire
* [Hold her until they take her from you. #virtue:courage]
    ~ set_flag("prologue-kalina-given")
    ~ record_decision("prologue-pyre", "kalina-taken")
    It is Ivan's wife, Mara, who takes her in the end. Gently. The doll falls; Mara picks it up.
    -> fire

= fire
The smoke goes up straight, the way it does when the dead are not angry.
Or the way it does when nothing at all is listening. #whisper
From the forest, something sings your name in a voice like yours. #shake
~ set_flag("prologue-complete")
-> END

= edge
The fields end here. The Samodivi Forest begins. Children are told not to look at it too long.
-> leave

= leave
* [Leave.]
    -> END
