import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

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
  const [showHoldRow, setShowHoldRow] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineValue, setTimelineValue] = useState(0);
  const [timelineMax, setTimelineMax] = useState(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadedVideoUrlRef = useRef(null);
  const menuRef = useRef(null);

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
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
        videoRef.current.srcObject = null;
      }
    };
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

  const captureImage = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    setSamples((prev) => [...prev, dataUrl]);
  };

  const startHolding = (event) => {
    if (event) event.preventDefault();
    stopHolding();

    intervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      captureImage();

      if (!streamRef.current && showTimeline) {
        const nextTime = Math.min((video.currentTime || 0) + 0.125, video.duration || 0);
        video.currentTime = nextTime;
        setTimelineValue(nextTime);
        if (nextTime >= (video.duration || 0)) stopHolding();
      }
    }, 125);
  };

  const stopHolding = (event) => {
    if (event) event.preventDefault();
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
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
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target && typeof ev.target.result === "string") {
          setSamples((prev) => [...prev, ev.target.result]);
        }
      };
      reader.readAsDataURL(file);
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
    setShowHoldRow(false);
    setShowTimeline(false);
    setTimelineValue(0);
    setTimelineMax(0);
  };

  const removeSampleAt = (index) => {
    setSamples((prev) => prev.filter((_, i) => i !== index));
  };

  const removeAllSamples = () => {
    if (!hasImages) return;
    setSamples([]);
    closeOtherMenus();
  };

  const downloadSamples = async () => {
    if (!hasImages) return;

    const zip = new JSZip();
    const cleanName = (name || "class").trim() || "class";

    samples.forEach((src, i) => {
      const base64Part = src.split(",")[1];
      zip.file(`${cleanName}_${i + 1}.png`, base64Part, { base64: true });
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

  const classImages = useMemo(() => samples.slice(), [samples]);

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
        <video ref={videoRef} className={showVideo ? "show" : ""} playsInline />

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
        {samples.map((src, index) => (
          <div className="sample-item" key={`${src}-${index}`}>
            <img
              src={src}
              alt={`sample-${index + 1}`}
              onClick={() => openModal(classImages, index)}
            />
            <button className="remove-img-btn" onClick={() => removeSampleAt(index)}>
              X
            </button>
          </div>
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

      <div className="class-container" id="classContainer">
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
        <img id="modalImg" src={modalImages[modalIndex] || ""} alt="preview" />
      </div>
    </>
  );
}


