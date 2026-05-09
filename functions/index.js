// ─── Crawley Croquet Club — Cloud Functions ──────────────────────────────────
// Triggers on any create, update, or delete of a document in the 'events'
// collection and fans out a push notification to all FCM tokens in 'fcm_tokens'.
//
// Deploy with:
//   firebase deploy --only functions
// ─────────────────────────────────────────────────────────────────────────────

const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { initializeApp }    = require('firebase-admin/app');
const { getFirestore }     = require('firebase-admin/firestore');
const { getMessaging }     = require('firebase-admin/messaging');

initializeApp();

const db = getFirestore();

// Base URL — update to crawleycroquetclub.org.uk once the custom domain is live.
const BASE_URL = 'https://magrizauk.github.io/crawleycroquetclub.org.uk';

// Build a URL with event details as query parameters so the page can open
// the view modal automatically when the notification is tapped.
function buildEventUrl(data) {
  const params = new URLSearchParams({
    event:  '1',
    title:  data.title  || '',
    type:   data.type   || '',
    date:   data.date   || '',
    notes:  data.notes  || '',
  });
  return BASE_URL + '/#calendar?' + params.toString();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eventTypeLabel(type) {
  const labels = {
    playtime:    'Play Session',
    social:      'Social Event',
    tournament:  'Tournament',
    maintenance: 'Maintenance',
    cancelled:   'Cancellation',
    other:       'Club Update',
  };
  return labels[type] || 'Club Update';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch (e) { return dateStr; }
}

// Fan out a notification payload to every token in the fcm_tokens collection.
// Removes any stale/invalid tokens automatically.
async function sendToAll(title, body, tag, eventUrl) {
  const snapshot = await db.collection('fcm_tokens').get();
  if (snapshot.empty) return;

  const tokens = snapshot.docs.map(d => d.data().token).filter(Boolean);
  if (!tokens.length) return;

  // FCM supports up to 500 tokens per sendEachForMulticast call.
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) {
    chunks.push(tokens.slice(i, i + 500));
  }

  const messaging = getMessaging();

  for (const chunk of chunks) {
    const response = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      webpush: {
        notification: {
          title,
          body,
          icon:  '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag,
          renotify: true,
        },
        fcmOptions: { link: eventUrl },
      },
    });

    // Clean up any tokens that FCM reports as invalid.
    const staleDeletes = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error && resp.error.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          staleDeletes.push(
            db.collection('fcm_tokens').doc(chunk[idx]).delete()
          );
        }
      }
    });
    if (staleDeletes.length) await Promise.all(staleDeletes);
  }
}


// ─── Triggers ────────────────────────────────────────────────────────────────

exports.onEventCreated = onDocumentCreated('events/{eventId}', async (event) => {
  const data  = event.data.data();
  const label = eventTypeLabel(data.type);
  const date  = formatDate(data.date);
  const title = `New ${label} Added`;
  const body  = `${data.title}${date ? ' — ' + date : ''}`;
  await sendToAll(title, body, 'ccc-event-created', buildEventUrl(data));
});

exports.onEventUpdated = onDocumentUpdated('events/{eventId}', async (event) => {
  const data  = event.data.after.data();
  const label = eventTypeLabel(data.type);
  const date  = formatDate(data.date);
  const title = `${label} Updated`;
  const body  = `${data.title}${date ? ' — ' + date : ''}`;
  await sendToAll(title, body, 'ccc-event-updated', buildEventUrl(data));
});

exports.onEventDeleted = onDocumentDeleted('events/{eventId}', async (event) => {
  const data  = event.data.data();
  const label = eventTypeLabel(data.type);
  const date  = formatDate(data.date);
  const title = `${label} Cancelled`;
  const body  = `${data.title}${date ? ' — ' + date : ''} has been removed from the calendar.`;
  await sendToAll(title, body, 'ccc-event-deleted', BASE_URL + '/#calendar');
});