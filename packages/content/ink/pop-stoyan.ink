// Pop Stoyan — the village priest. Sincere, frightened that God has turned away from Mrak.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL record_decision(id, choice)

"God be with you. Come in from the cold. The church is the only warm house in Mrak, and it is not warm."
{get_flag("bell-rang-333"): "You heard the bell, too. Three times. Petko swears he slept through it." #whisper}
* [Ask for his blessing. #empathy #virtue:humility]
    He makes the sign of the cross over you and his voice steadies.
    "Go with God. And do not go into the forest after dark, whatever it promises."
    ~ record_decision("stoyan-blessing", "asked")
    -> END
* [Ask where the church roof money came from. #threat #requires:flag:stoyan-confessed]
    "Do not," he says. "Not here. Not before the icons." #whisper
    -> END
* [Ask about the old burial register. #occult]
    "The register is the Church's, not the village's. There is nothing in it for you."
    He does not look at the cupboard where it is kept.
    ~ set_flag("register-noticed")
    -> END
* [Tell him the herb-woman helps more than his prayers. #sin:pride #threat]
    "Then go to her, and see what her herbs do at the Last Judgement." #shake
    ~ record_decision("stoyan-neda", "mocked")
    -> END
