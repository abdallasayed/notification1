import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { MessageType } from "./types";

admin.initializeApp();

const db = admin.firestore();
const fcm = admin.messaging();

const getUser = async (userId: string) => {
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) return null;
    return userSnap.data();
};

const sendNotification = async (
    recipientId: string,
    payload: admin.messaging.MessagingPayload
) => {
    const recipient = await getUser(recipientId);
    if (!recipient?.fcmTokens?.length) return;

    const tokens = recipient.fcmTokens;
    const response = await fcm.sendToDevice(tokens, payload);

    const tokensToRemove: Promise<any>[] = [];
    response.results.forEach((result, index) => {
        const error = result.error;
        if (error) {
            console.error("Failure sending notification to", tokens[index], error);
            if (["messaging/invalid-registration-token", "messaging/registration-token-not-registered"].includes(error.code)) {
                tokensToRemove.push(
                    db.collection("users").doc(recipientId).update({
                        fcmTokens: admin.firestore.FieldValue.arrayRemove(tokens[index]),
                    })
                );
            }
        }
    });
    await Promise.all(tokensToRemove);
};

const getMessageBody = (message: any): string => {
    switch (message.type as MessageType) {
        case MessageType.IMAGE: return "🖼️ بعت صورة جديدة";
        case MessageType.AUDIO: return "🎤 بعت رسالة صوتية";
        case MessageType.KISS: return "😘 بعت بوسة";
        case MessageType.HEARTBEAT_PULSE: return "❤️ بعت نبضة قلب";
        default: return message.text?.substring(0, 100) || "رسالة جديدة...";
    }
};

export const onNewMessage = functions.region("me-west1").firestore
    .document("conversations/{convoId}/messages/{messageId}")
    .onCreate(async (snap, context) => {
        const message = snap.data();
        const sender = await getUser(message.senderId);
        if (!sender?.partnerId) return;
        
        const payload: admin.messaging.MessagingPayload = {
            notification: {
                title: `رسالة جديدة من ${sender.firstName}`,
                body: getMessageBody(message),
                icon: sender.avatar,
                tag: `chat_${context.params.convoId}`,
            },
            data: { view: "chat" },
        };
        await sendNotification(sender.partnerId, payload);
    });

export const onNewMemory = functions.region("me-west1").firestore
    .document("conversations/{convoId}/memories/{memoryId}")
    .onCreate(async (snap) => {
        const memory = snap.data();
        const creator = await getUser(memory.creatorId);
        if (!creator?.partnerId) return;

        const payload: admin.messaging.MessagingPayload = {
            notification: {
                title: "ذكرى جديدة! ✨",
                body: `${creator.firstName} ضاف ذكرى جديدة: "${memory.title}"`,
                icon: creator.avatar,
                tag: "new_memory",
            },
            data: { view: "memories" },
        };
        await sendNotification(creator.partnerId, payload);
    });

export const onNewLetter = functions.region("me-west1").firestore
    .document("conversations/{convoId}/letters/{letterId}")
    .onCreate(async (snap) => {
        const letter = snap.data();
        const writer = await getUser(letter.writerId);
        if (!writer?.partnerId) return;

        const payload: admin.messaging.MessagingPayload = {
            notification: {
                title: "جواب جديد في انتظارك! 💌",
                body: `${writer.firstName} كتبلك جواب: "افتح لما ${letter.condition}"`,
                icon: writer.avatar,
                tag: "new_letter",
            },
            data: { view: "letters" },
        };
        await sendNotification(writer.partnerId, payload);
    });

export const onDailyQuestionAnswer = functions.region("me-west1").firestore
    .document("conversations/{convoId}/dailyQuestions/{date}")
    .onUpdate(async (change) => {
        const beforeAnswers = change.before.data().answers || {};
        const afterAnswers = change.after.data().answers || {};
        const answeredUserId = Object.keys(afterAnswers).find((id) => !beforeAnswers[id]);
        if (!answeredUserId) return;

        const userWhoAnswered = await getUser(answeredUserId);
        if (!userWhoAnswered?.partnerId) return;

        const payload: admin.messaging.MessagingPayload = {
            notification: {
                title: "إجابة جديدة! 🤔",
                body: `${userWhoAnswered.firstName} جاوب على سؤال النهاردة. ادخل شوف إجابته!`,
                icon: userWhoAnswered.avatar,
                tag: "new_answer",
            },
            data: { view: "dailyQuestion" },
        };
        await sendNotification(userWhoAnswered.partnerId, payload);
    });
