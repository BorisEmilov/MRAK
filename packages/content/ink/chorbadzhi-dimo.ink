// Chorbadzhi Dimo — the headman (M1 culprit). Courteous, tired, afraid of the dark and of debt.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL villager_state(id)
EXTERNAL record_decision(id, choice)

{villager_state("chorbadzhi-dimo") == "terrified": Dimo keeps a lamp burning though it is day. His hands will not stay still.}
"Guardian. Sit, sit. The aga's man was here again. Everybody wants something from Dimo."
* [Ask about the forest. #empathy]
    -> grove
* [Ask why he sleeps with a lamp lit. #threat #requires:flag:bell-rang-333]
    He looks at the lamp and not at you.
    "A man with my debts sleeps badly. That is all. That is all, guardian." #whisper
    ~ record_decision("dimo-lamp", "asked")
    -> END
* [Wish him a good day and leave.]
    "God keep you." He is already counting something on his fingers.
    -> END

= grove
"The old grove eats our sheep and our sons. My grandfather said so, and he was not a fool."
"Burn the edge of it. Open the pasture. The aga will lower the tithe if the land is worked."
~ set_flag("dimo-asked-grove")
* [Agree to clear the grove with him. #threat]
    ~ set_flag("grove-agreed")
    ~ record_decision("dimo-grove", "agreed")
    "Good. Good. A man of sense. Come to me when the ground is dry."
    -> END
* [Refuse. The forest is not his to burn. #empathy #virtue:courage]
    ~ record_decision("dimo-grove", "refused")
    "Then pay the tithe for us, guardian, since you are so rich in principles."
    -> END
* [Tell him you will think on it. #lie]
    "Think quickly. Winter thinks faster than you."
    -> END
