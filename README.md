# Chat Archive

An offline Android app that opens WhatsApp chat exports (.zip or .txt) and shows them as a
searchable conversation. Add as many chats as you like. Everything is stored on the phone.
The app declares no permissions, so it cannot use the internet.

## Get the APK

1. Create a new empty repository on GitHub and upload everything in this folder
   (keep the `.github` folder).
2. Open the repository's **Actions** tab. The "Build APK" run starts by itself
   (or press **Run workflow**). It takes about 3 to 5 minutes.
3. Open the finished run and download **ChatArchive-apk** at the bottom. Unzip it to get `app-debug.apk`.
4. Send that file to anyone. On their Android phone they open it and allow
   "Install unknown apps" for whatever app they opened it from.

## Use it

1. In WhatsApp, open a chat, then Menu, More, Export chat. Choose Include media to keep photos and voice notes.
2. Open Chat Archive, tap **Add chats**, pick one or more exports.
3. Tap a chat to read it. Use the search icon to find words or jump to a date.
   Menu (three dots) lets you swap which side is "you", fix day/month order, or remove a chat.
