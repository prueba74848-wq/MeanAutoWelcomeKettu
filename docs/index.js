(function () {
  "use strict";
  var module = { exports: {} };

  var CONFIG = {
    // Leave empty to greet in every server, or put guild IDs here to limit it
    guildIds: [],
    // Delay before sending, in ms (random between min and max)
    minDelay: 1000,
    maxDelay: 3000
  };

  // Only this one sticker is used
  var STICKER_IDS = [
    "1394097054707486862"
  ];

  var vd = vendetta;
  var logger = vd.logger;
  var findByProps = vd.metro.findByProps;
  var findByStoreName = vd.metro.findByStoreName;

  // Same lookups AutoReact uses (these are known to resolve on the Android TV build)
  var HTTP = findByProps("put", "del", "patch", "post", "get", "getAPIBaseURL");
  var TokenStore = findByStoreName("UserAuthTokenStore") || findByStoreName("AuthenticationStore");
  var UserStore = findByStoreName("UserStore") || findByProps("getCurrentUser", "getUser");
  var ChannelStore = findByStoreName("ChannelStore");
  var FD = findByProps("_interceptors");

  // Only used as fallbacks
  var FluxDispatcher = vd.metro.common.FluxDispatcher;
  var MessageActions = findByProps("sendMessage", "receiveMessage");

  var API_BASE = "https://discord.com/api/v9";
  var USER_JOIN = 7;
  var greeted = new Set();
  var interceptFn = null;
  var subscribedFn = null;

  function toast(text) {
    logger.log("[AutoWelcome] " + text);
    try {
      vd.ui.toasts.showToast("[AutoWelcome] " + text, vd.ui.assets.getAssetIDByName("Small"));
    } catch (e) {
      logger.log("[AutoWelcome] toast failed: " + String(e));
    }
  }

  function getToken() {
    try {
      if (!TokenStore) return null;
      return TokenStore.getToken ? TokenStore.getToken() : TokenStore.token;
    } catch (e) {
      return null;
    }
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function currentUserId() {
    try {
      var me = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
      return me && me.id;
    } catch (e) {
      return null;
    }
  }

  function guildOf(payload, message, channelId) {
    if (payload.guildId) return payload.guildId;
    if (message.guild_id) return message.guild_id;
    try {
      var ch = ChannelStore && ChannelStore.getChannel && ChannelStore.getChannel(channelId);
      return ch && ch.guild_id;
    } catch (e) {
      return null;
    }
  }

  function sendSticker(channelId, guildId, messageId) {
    var stickerId = pick(STICKER_IDS);

    // Preferred: send straight through Discord's REST API (the way AutoReact does it)
    if (HTTP && typeof HTTP.post === "function") {
      var ref = { channel_id: channelId, message_id: messageId };
      if (guildId) ref.guild_id = guildId;

      var req = {
        url: API_BASE + "/channels/" + channelId + "/messages",
        body: {
          content: "",
          tts: false,
          flags: 0,
          nonce: String(Date.now() * 1000 + Math.floor(Math.random() * 1000)),
          sticker_ids: [stickerId],
          message_reference: ref,
          allowed_mentions: { parse: ["users"], replied_user: true }
        }
      };
      var token = getToken();
      if (token) req.headers = { Authorization: token };

      return Promise.resolve(HTTP.post(req)).catch(function (e) {
        var status = e && (e.status != null ? e.status : e.message);
        toast("sticker failed: " + String(status));
      });
    }

    // Fallback: the client's own send function
    if (MessageActions && typeof MessageActions.sendMessage === "function") {
      return Promise.resolve(
        MessageActions.sendMessage(
          channelId,
          { content: "", tts: false, invalidEmojis: [], validNonShortcutEmojis: [] },
          undefined,
          {
            stickerIds: [stickerId],
            messageReference: { guild_id: guildId, channel_id: channelId, message_id: messageId },
            allowedMentions: { parse: ["users"], replied_user: true }
          }
        )
      ).catch(function (e) {
        toast("sticker failed: " + String(e && e.message));
      });
    }

    toast("cannot send: no sender found on this device");
  }

  function handle(payload) {
    if (!payload || payload.type !== "MESSAGE_CREATE" || payload.optimistic) return;
    var message = payload.message;
    if (!message || message.type !== USER_JOIN) return;

    var channelId = payload.channelId || message.channel_id;
    var guildId = guildOf(payload, message, channelId);

    if (CONFIG.guildIds.length && CONFIG.guildIds.indexOf(guildId) === -1) return;
    if (!channelId || !message.id) return;
    if (greeted.has(message.id)) return;
    greeted.add(message.id);

    var userId = message.author && message.author.id;
    if (!userId || userId === currentUserId()) return;

    var delay = CONFIG.minDelay + Math.random() * Math.max(0, CONFIG.maxDelay - CONFIG.minDelay);
    var messageId = message.id;
    setTimeout(function () {
      try {
        sendSticker(channelId, guildId, messageId);
      } catch (e) {
        toast("send error: " + String(e && e.message));
      }
    }, delay);
  }

  module.exports = {
    onLoad: function () {
      // Preferred: hook the dispatcher the same way AutoReact does
      if (FD && Array.isArray(FD._interceptors)) {
        interceptFn = function (payload) {
          try {
            handle(payload);
          } catch (e) {
            logger.error("[AutoWelcome] handler error", e);
          }
          return null;
        };
        FD._interceptors.push(interceptFn);
      } else if (FluxDispatcher && FluxDispatcher.subscribe) {
        subscribedFn = function (payload) {
          try {
            handle(payload);
          } catch (e) {
            logger.error("[AutoWelcome] handler error", e);
          }
        };
        FluxDispatcher.subscribe("MESSAGE_CREATE", subscribedFn);
      } else {
        toast("PROBLEM: no way to listen for messages on this device");
      }
    },
    onUnload: function () {
      if (interceptFn && FD && FD._interceptors) {
        FD._interceptors = FD._interceptors.filter(function (f) { return f !== interceptFn; });
        interceptFn = null;
      }
      if (subscribedFn && FluxDispatcher && FluxDispatcher.unsubscribe) {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", subscribedFn);
        subscribedFn = null;
      }
      greeted.clear();
    }
  };

  return module.exports;
})();