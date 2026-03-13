import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

const CAPTURE_INTERVAL_MS = 80;
const UPLOAD_FRAME_STEP_SECONDS = 0.08;
const MAX_CAPTURE_DIMENSION = 1024;
const JPEG_QUALITY = 0.82;
const SEEK_TIMEOUT_MS = 140;
const SAMPLE_FLUSH_DELAY_MS = 160;
const MAX_PENDING_SAMPLES = 4;

const buildSampleId = () => (
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const SampleThumb = memo(function SampleThumb({
  sample,
  index,
  onOpen,
  onRemove,
}) {
  return (
    <div className="sample-item">
      <img
        src={sample.previewUrl}
        alt={`sample-${index + 1}`}
        loading="lazy"
        decoding="async"
        onClick={() => onOpen(index)}
      />
      <button className="remove-img-btn" onClick={() => onRemove(index)}>
        X
      </button>
    </div>
  );
});

function ClassBox({
  id,
  initialName,
  onDelete,
  openModal,
  closeOtherMenus,
  activeMenuId,
  setActiveMenuId,
}) {
  const [name, setName] = useState(initialName);
  const [samples, setSamples] = useState([]);
  const [showVideo, setShowVideo] = useState(false);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [showHoldRow, setShowHoldRow] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineValue, setTimelineValue] = useState(0);
  const [timelineMax, setTimelineMax] = useState(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const holdTimeoutRef = useRef(null);
  const isHoldingRef = useRef(false);
  const isCaptureBusyRef = useRef(false);
  const fileInputRef = useRef(null);
  const uploadedVideoUrlRef = useRef(null);
  const menuRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const samplesRef = useRef([]);
  const pendingSamplesRef = useRef([]);
  const flushTimeoutRef = useRef(null);

  const hasImages = samples.length > 0;
  const isMenuOpen = activeMenuId === id;

  useEffect(() => {
    const handler = (event) => {
      if (isMenuOpen && menuRef.current && !menuRef.current.contains(event.target)) {
        closeOtherMenus();
      }
    };

    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [isMenuOpen, closeOtherMenus]);

  useEffect(() => {
    return () => {
      stopHolding();
      stopStream();
      revokeUploadedVideoUrl();
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      pendingSamplesRef.current.forEach((sample) => URL.revokeObjectURL(sample.previewUrl));
      samplesRef.current.forEach((sample) => URL.revokeObjectURL(sample.previewUrl));
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  const flushPendingSamples = useCallback(() => {
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }

    const pending = pendingSamplesRef.current;
    if (pending.length === 0) return;

    pendingSamplesRef.current = [];
    setSamples((prev) => [...prev, ...pending]);
  }, []);

  const enqueueSample = useCallback((sample) => {
    pendingSamplesRef.current.push(sample);

    if (pendingSamplesRef.current.length >= MAX_PENDING_SAMPLES) {
      flushPendingSamples();
      return;
    }

    if (!flushTimeoutRef.current) {
      flushTimeoutRef.current = setTimeout(() => {
        flushPendingSamples();
      }, SAMPLE_FLUSH_DELAY_MS);
    }
  }, [flushPendingSamples]);

  const getAllSamples = useCallback(() => {
    const pending = pendingSamplesRef.current;
    if (pending.length === 0) return samplesRef.current;
    return [...samplesRef.current, ...pending];
  }, []);

  const revokeUploadedVideoUrl = () => {
    if (uploadedVideoUrlRef.current) {
      URL.revokeObjectURL(uploadedVideoUrlRef.current);
      uploadedVideoUrlRef.current = null;
    }
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const setVideoFromUpload = (url) => {
    const video = videoRef.current;
    if (!video) return;

    revokeUploadedVideoUrl();
    uploadedVideoUrlRef.current = url;

    video.srcObject = null;
    video.src = url;

    setIsWebcamActive(false);
    setShowVideo(true);
    setShowHoldRow(true);
    setShowTimeline(true);
    setTimelineValue(0);
    setTimelineMax(0);

    const onLoadedMetadata = () => {
      setTimelineMax(Number.isFinite(video.duration) ? video.duration : 0);
      setTimelineValue(video.currentTime || 0);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
  };

  const getTargetCaptureSize = (video) => {
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 480;
    const maxSide = Math.max(sourceWidth, sourceHeight);

    if (maxSide <= MAX_CAPTURE_DIMENSION) {
      return { width: sourceWidth, height: sourceHeight };
    }

    const scale = MAX_CAPTURE_DIMENSION / maxSide;
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    };
  };

  const waitForSeek = (video, targetTime) => new Promise((resolve) => {
    let resolved = false;
    let timeoutId = null;

    const finalize = () => {
      if (resolved) return;
      resolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onSeeked);
      resolve();
    };

    const onSeeked = () => finalize();
    timeoutId = setTimeout(finalize, SEEK_TIMEOUT_MS);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onSeeked, { once: true });
    video.currentTime = targetTime;
    setTimelineValue(targetTime);
  });

  const captureImage = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || isCaptureBusyRef.current) return;

    isCaptureBusyRef.current = true;
    try {
      const canvas = captureCanvasRef.current || document.createElement("canvas");
      captureCanvasRef.current = canvas;
      const { width, height } = getTargetCaptureSize(video);
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
      });

      if (blob) {
        const previewUrl = URL.createObjectURL(blob);
        const id = buildSampleId();
        enqueueSample({ id, previewUrl, blob });
      }
    } finally {
      isCaptureBusyRef.current = false;
    }
  }, [enqueueSample]);

  const startHolding = (event) => {
    if (event) event.preventDefault();
    stopHolding();
    isHoldingRef.current = true;

    const runCaptureLoop = async () => {
      if (!isHoldingRef.current) return;

      const cycleStart = performance.now();
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        holdTimeoutRef.current = setTimeout(runCaptureLoop, CAPTURE_INTERVAL_MS);
        return;
      }

      await captureImage();

      if (!streamRef.current && showTimeline) {
        const nextTime = Math.min((video.currentTime || 0) + UPLOAD_FRAME_STEP_SECONDS, video.duration || 0);
        await waitForSeek(video, nextTime);
        if (nextTime >= (video.duration || 0)) {
          stopHolding();
          return;
        }
      }

      const elapsed = performance.now() - cycleStart;
      const delay = Math.max(0, CAPTURE_INTERVAL_MS - elapsed);
      holdTimeoutRef.current = setTimeout(runCaptureLoop, delay);
    };

    runCaptureLoop();
  };

  const stopHolding = (event) => {
    if (event) event.preventDefault();
    isHoldingRef.current = false;
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    flushPendingSamples();
  };

  const handleWebcam = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      stopStream();
      revokeUploadedVideoUrl();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
      });

      streamRef.current = stream;
      video.src = "";
      video.srcObject = stream;

      setIsWebcamActive(true);
      setShowVideo(true);
      setShowHoldRow(true);
      setShowTimeline(false);

      await video.play();
    } catch (err) {
      console.error("Camera access denied or error:", err);
      alert("Unable to access camera. Check permissions or try a different browser.");
    }
  };

  const handleUploadClick = () => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  };

  const handleUploadChange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (file.type.startsWith("image/")) {
      const previewUrl = URL.createObjectURL(file);
      const id = buildSampleId();
      enqueueSample({ id, previewUrl, blob: file });
      return;
    }

    if (file.type.startsWith("video/")) {
      stopStream();
      setVideoFromUpload(URL.createObjectURL(file));
    }
  };

  const closeVideo = () => {
    stopHolding();
    stopStream();
    revokeUploadedVideoUrl();

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.src = "";
      video.srcObject = null;
    }

    setShowVideo(false);
    setIsWebcamActive(false);
    setShowHoldRow(false);
    setShowTimeline(false);
    setTimelineValue(0);
    setTimelineMax(0);
  };

  const removeSampleAt = (index) => {
    flushPendingSamples();
    setSamples((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const removeAllSamples = () => {
    if (!hasImages) return;
    flushPendingSamples();
    setSamples((prev) => {
      prev.forEach((sample) => URL.revokeObjectURL(sample.previewUrl));
      return [];
    });
    closeOtherMenus();
  };

  const downloadSamples = async () => {
    if (!hasImages) return;
    flushPendingSamples();

    const zip = new JSZip();
    const cleanName = (name || "class").trim() || "class";

    getAllSamples().forEach((sample, i) => {
      zip.file(`${cleanName}_${i + 1}.jpg`, sample.blob);
    });

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${cleanName}.zip`;
    link.click();

    URL.revokeObjectURL(url);
    closeOtherMenus();
  };

  const samplePreviewUrls = useMemo(
    () => samples.map((item) => item.previewUrl),
    [samples]
  );

  const handleOpenSample = useCallback((index) => {
    openModal(samplePreviewUrls, index);
  }, [openModal, samplePreviewUrls]);

  return (
    <div className="class-box">
      <div className="class-header">
        <span
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Type class name..."
          onBlur={(e) => setName(e.currentTarget.textContent || "")}
        >
          {name}
        </span>

        <div
          className="menu"
          ref={menuRef}
          onClick={(e) => {
            e.stopPropagation();
            setActiveMenuId(isMenuOpen ? null : id);
          }}
        >
          &#8942;
          <div className={`menu-options ${isMenuOpen ? "show" : ""}`}>
            <div onClick={() => onDelete(id)}>Delete class</div>
            <div className={hasImages ? "" : "disabled-option"} onClick={removeAllSamples}>
              Remove All Samples
            </div>
            <div className={hasImages ? "" : "disabled-option"} onClick={downloadSamples}>
              Download Samples
            </div>
          </div>
        </div>
      </div>

      <div className="sample-label">Add image Samples:</div>

      <div className="btn-row">
        <button className="btn webcam-btn" onClick={handleWebcam}>Webcam</button>
        <button className="btn upload-btn" onClick={handleUploadClick}>Upload</button>
      </div>

      <div className={`btn-row hold-record-row ${showHoldRow ? "show" : ""}`}>
        <button
          className="btn hold-record-btn"
          onMouseDown={startHolding}
          onMouseUp={stopHolding}
          onMouseLeave={stopHolding}
          onTouchStart={startHolding}
          onTouchEnd={stopHolding}
          onTouchCancel={stopHolding}
        >
          Hold &amp; Record
        </button>
      </div>

      <div className="video-container">
        <video
          ref={videoRef}
          className={`${showVideo ? "show" : ""} ${isWebcamActive ? "mirror-view" : ""}`.trim()}
          playsInline
          preload="metadata"
        />

        <input
          type="range"
          className={`video-timeline ${showTimeline ? "show" : ""}`}
          min="0"
          max={timelineMax}
          value={timelineValue}
          step="0.01"
          onChange={(e) => {
            const video = videoRef.current;
            const next = parseFloat(e.target.value || "0");
            setTimelineValue(next);
            if (video) video.currentTime = next;
          }}
        />

        <button className={`close-video-btn ${showVideo ? "show" : ""}`} onClick={closeVideo}>
          X
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={handleUploadChange}
      />

      <div className="samples-preview">
        {samples.map((sample, index) => (
          <SampleThumb
            key={sample.id}
            sample={sample}
            index={index}
            onOpen={handleOpenSample}
            onRemove={removeSampleAt}
          />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [classes, setClasses] = useState([{ id: 1, name: "Class 1" }]);
  const [nextId, setNextId] = useState(2);
  const [activeMenuId, setActiveMenuId] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalImages, setModalImages] = useState([]);
  const [modalIndex, setModalIndex] = useState(0);

  const closeOtherMenus = () => setActiveMenuId(null);

  const addClassBox = () => {
    if (classes.length === 0) {
      setClasses([{ id: 1, name: "Class 1" }]);
      setNextId(2);
      return;
    }

    setClasses((prev) => [...prev, { id: nextId, name: `Class ${nextId}` }]);
    setNextId((prev) => prev + 1);
  };

  const deleteClass = (id) => {
    setClasses((prev) => prev.filter((item) => item.id !== id));
    closeOtherMenus();
  };

  const openModal = (images, index) => {
    setModalImages(images);
    setModalIndex(index);
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const showPrev = () => {
    if (modalImages.length === 0) return;
    setModalIndex((prev) => (prev - 1 + modalImages.length) % modalImages.length);
  };

  const showNext = () => {
    if (modalImages.length === 0) return;
    setModalIndex((prev) => (prev + 1) % modalImages.length);
  };

  useEffect(() => {
    const handler = (event) => {
      if (!modalOpen) return;
      if (event.key === "ArrowLeft") showPrev();
      if (event.key === "ArrowRight") showNext();
      if (event.key === "Escape") closeModal();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modalOpen, modalImages.length]);

  return (
    <>
      <div className="logo-container">
        <img src="/Images/Vision Snap logo.png" alt="Vision Snap Logo" className="logo" />
      </div>

      <div className="class-container">
        {classes.map((classItem) => (
          <ClassBox
            key={classItem.id}
            id={classItem.id}
            initialName={classItem.name}
            onDelete={deleteClass}
            openModal={openModal}
            closeOtherMenus={closeOtherMenus}
            activeMenuId={activeMenuId}
            setActiveMenuId={setActiveMenuId}
          />
        ))}

        <div className="add-class" onClick={addClassBox}>
          + Add a class
        </div>
      </div>

      <div id="imgModal" className={modalOpen ? "show" : ""}>
        <span className="close-btn" onClick={closeModal}>
          &times;
        </span>
        <div className="nav-btn prev-btn" onClick={showPrev}>
          &#10094;
        </div>
        <div className="nav-btn next-btn" onClick={showNext}>
          &#10095;
        </div>
        <img src={modalImages[modalIndex] || ""} alt="preview" />
      </div>
    </>
  );
}


