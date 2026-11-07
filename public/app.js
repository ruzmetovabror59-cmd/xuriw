const socket = io();
const roomInput = document.getElementById("room");
const createBtn = document.getElementById("create");
const joinBtn = document.getElementById("join");
const cameraBtn = document.getElementById("camera");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");

let room = "";
let localStream = null;
let pc = null;
let joined = false;
let makingOffer = false;
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function status(message) { statusEl.textContent = message; }
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
}
createBtn.onclick = () => { roomInput.value = makeCode(); status("Kod yaratildi. Uni ikkinchi ishtirokchiga yuboring."); };
roomInput.addEventListener("input", () => roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6));

function createPeer() {
  if (pc) pc.close();
  pc = new RTCPeerConnection(config);
  if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.ontrack = (event) => { remoteVideo.srcObject = event.streams[0]; status("Jonli video ulandi."); };
  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit("ice-candidate", event.candidate);
  };
  pc.onconnectionstatechange = () => {
    if (pc && ["disconnected","failed","closed"].includes(pc.connectionState)) {
      status("Ulanish uzildi. Qayta ulanish uchun xonaga qayta kiring.");
    }
  };
  return pc;
}

joinBtn.onclick = () => {
  const entered = roomInput.value.trim();
  if (!/^[A-Z0-9]{6}$/.test(entered)) return status("6 belgili xona kodini kiriting.");
  room = entered;
  socket.emit("join-room", room, (result) => {
    if (!result?.ok) return status(result?.error || "Xonaga kirib bo‘lmadi.");
    joined = true;
    joinBtn.disabled = true;
    roomInput.disabled = true;
    cameraBtn.disabled = false;
    createBtn.disabled = true;
    createPeer();
    status(result.count === 2 ? "Xonaga ulandingiz. Ikkinchi ishtirokchi bor." : "Xona ochildi. Ikkinchi ishtirokchini kutyapmiz.");
  });
};

cameraBtn.onclick = async () => {
  if (!joined) return;
  try {
    // Explicit user click + browser permission are required.
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    cameraBtn.disabled = true;
    stopBtn.disabled = false;
    status("Kamera va mikrofon yoqildi. Jonli uzatish boshlandi.");
    if (pc.signalingState === "stable" && remoteVideo.srcObject) {
      // Existing peer can renegotiate through the offer handler below.
    }
    await makeOffer();
  } catch (err) {
    status("Kameraga ruxsat berilmadi yoki qurilmada kamera topilmadi.");
  }
};

async function makeOffer() {
  if (!pc || makingOffer) return;
  try {
    makingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", pc.localDescription);
  } catch (e) {
    status("Video ulanishini boshlashda xatolik yuz berdi.");
  } finally { makingOffer = false; }
}

socket.on("peer-joined", () => {
  status("Ikkinchi ishtirokchi xonaga kirdi. Kamera ulashish uchun tugmani bosing.");
  if (localStream) makeOffer();
});
socket.on("offer", async (offer) => {
  if (!pc) createPeer();
  try {
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", pc.localDescription);
  } catch (e) { status("Video taklifini qabul qilib bo‘lmadi."); }
});
socket.on("answer", async (answer) => {
  try { if (pc && pc.signalingState === "have-local-offer") await pc.setRemoteDescription(answer); }
  catch (e) { status("Ulanishni yakunlab bo‘lmadi."); }
});
socket.on("ice-candidate", async (candidate) => {
  try { if (pc) await pc.addIceCandidate(candidate); } catch (_) {}
});
socket.on("peer-left", () => {
  remoteVideo.srcObject = null;
  status("Ikkinchi ishtirokchi xonadan chiqdi.");
});

stopBtn.onclick = () => {
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  localVideo.srcObject = null;
  stopBtn.disabled = true;
  cameraBtn.disabled = !joined;
  status("Jonli uzatish to‘xtatildi.");
  if (pc) { pc.getSenders().forEach(sender => { if (sender.track) pc.removeTrack(sender); }); }
};

window.addEventListener("beforeunload", () => {
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  if (pc) pc.close();
});

// Dumaloq video yozish: kamera orqali yozadi, galereyadan fayl tanlamaydi.
const prepareRecorderBtn = document.getElementById("prepareRecorder");
const holdRecordBtn = document.getElementById("holdRecord");
const circlePreview = document.getElementById("circlePreview");
const circleResult = document.getElementById("circleResult");
const circlePlaceholder = document.getElementById("circlePlaceholder");
const recordStatus = document.getElementById("recordStatus");

let recorderStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let releaseRequested = false;

function setRecordStatus(message) {
  if (recordStatus) recordStatus.textContent = message;
}

async function prepareRecorderCamera() {
  if (recorderStream && recorderStream.getVideoTracks().some(t => t.readyState === "live")) return recorderStream;
  if (localStream && localStream.getVideoTracks().some(t => t.readyState === "live")) {
    recorderStream = localStream;
  } else {
    recorderStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  }
  circlePreview.srcObject = recorderStream;
  circlePreview.hidden = false;
  circleResult.hidden = true;
  circlePlaceholder.hidden = true;
  holdRecordBtn.disabled = false;
  setRecordStatus("Kamera tayyor. Yozish uchun qizil tugmani bosib turing.");
  return recorderStream;
}

prepareRecorderBtn?.addEventListener("click", async () => {
  try { await prepareRecorderCamera(); }
  catch (err) { setRecordStatus("Kameraga ruxsat berilmadi yoki kamera topilmadi. Brauzer ruxsatlarini tekshiring."); }
});

async function beginCircleRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") return;
  releaseRequested = false;
  try {
    const stream = await prepareRecorderCamera();
    if (releaseRequested) return;
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : (MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "");
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordedChunks = [];
    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      if (!recordedChunks.length) {
        setRecordStatus("Video yozilmadi. Qayta urinib ko‘ring.");
        return;
      }
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "video/webm" });
      circleResult.src = URL.createObjectURL(blob);
      circleResult.hidden = false;
      circlePreview.hidden = true;
      setRecordStatus("Video tayyor. Uni shu sahifada ko‘rishingiz mumkin.");
      holdRecordBtn.classList.remove("recording");
      holdRecordBtn.textContent = "● Qayta yozish";
    };
    mediaRecorder.start();
    holdRecordBtn.classList.add("recording");
    holdRecordBtn.textContent = "● Yozilyapti… qo‘yib yuboring";
    setRecordStatus("Yozilyapti… tugmani qo‘yib yuboring.");
    if (releaseRequested && mediaRecorder.state === "recording") mediaRecorder.stop();
  } catch (err) {
    setRecordStatus("Yozishni boshlash uchun kameraga ruxsat kerak.");
  }
}

function endCircleRecording() {
  releaseRequested = true;
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
}

holdRecordBtn?.addEventListener("pointerdown", event => {
  event.preventDefault();
  if (!holdRecordBtn.disabled) beginCircleRecording();
});
["pointerup", "pointercancel", "lostpointercapture"].forEach(type => {
  holdRecordBtn?.addEventListener(type, endCircleRecording);
});
holdRecordBtn?.addEventListener("contextmenu", event => event.preventDefault());
