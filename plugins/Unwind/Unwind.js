(async function () {
  "use strict";

  if (window.stashUnwindPluginLoaded) {
    console.log("Unwind Plugin is already loaded");
    return;
  }
  window.stashUnwindPluginLoaded = true;
  console.log("Unwind Plugin started");

  // =================
  // GraphQL Queries
  // =================
  const performGraphQLQuery = async (query, variables = {}) => {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `GraphQL query failed with status ${response.status}: ${responseText}`,
      );
    }
    const json = await response.json();
    if (json.errors) {
      console.error("GraphQL Errors:", json.errors);
      throw new Error(`GraphQL query failed: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
  };

  const HISTORY_QUERY = `
    query UnwindHistory($scene_filter: SceneFilterType!) {
      findScenes(filter: {per_page: -1}, scene_filter: $scene_filter) {
        scenes { o_history play_history }
      }
    }
  `;

  const UNWIND_ITEMS_QUERY = `
    query UnwindItems($scene_filter: SceneFilterType, $image_filter: ImageFilterType) {
        findScenes(filter: {per_page: -1}, scene_filter: $scene_filter) {
            scenes { __typename id title created_at o_history play_history performers { id name } tags { id name } paths { screenshot } }
        }
        findImages(filter: {per_page: -1}, image_filter: $image_filter) {
            images { __typename id id title created_at o_counter paths { thumbnail } }
        }
    }
  `;

  // =================
  // Data Calculation
  // =================
  function seedableRandom(seed) {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function calculateGeneralStats(
    stats,
    oCountEvents,
    allScenes,
    allImages,
    year,
  ) {
    // New Scenes
    const newScenesList = allScenes.filter(
      (s) => new Date(s.created_at).getFullYear() == year,
    );
    stats.newScenes = newScenesList.length;
    stats.newScenesImage = null;
    if (newScenesList.length > 0) {
      const mostRecentNewScene = newScenesList.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      )[0];
      stats.newScenesImage = mostRecentNewScene.paths?.screenshot || null;
    }

    // New Images
    const newImagesList = allImages.filter(
      (i) => new Date(i.created_at).getFullYear() == year,
    );
    stats.newImages = newImagesList.length;
    stats.newImagesImage = null;
    if (newImagesList.length > 0) {
      const mostRecentNewImage = newImagesList.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      )[0];
      stats.newImagesImage = mostRecentNewImage.paths?.thumbnail || null;
    }

    // Total O-Counts
    stats.totalOCounts = oCountEvents.length;
    stats.totalOCountsImage = null;
    if (oCountEvents.length > 0) {
      const scenesWithOCounts = allScenes.filter(
        (s) => s.o_history && s.o_history.length > 0,
      );
      if (scenesWithOCounts.length > 0) {
        const randomIndex = Math.floor(
          seedableRandom(year) * scenesWithOCounts.length,
        );
        stats.totalOCountsImage =
          scenesWithOCounts[randomIndex].paths?.screenshot || null;
      }
    }

    const oCountsByItem = oCountEvents.reduce((acc, curr) => {
      acc[curr.item.id] = (acc[curr.item.id] || 0) + 1;
      return acc;
    }, {});

    stats.topOScene = { id: null, title: "N/A", count: 0, image: null };
    for (const itemId in oCountsByItem) {
      const item = allScenes.find((i) => i.id === itemId);
      const count = oCountsByItem[itemId];
      if (item && count > stats.topOScene.count) {
        stats.topOScene = {
          id: item.id,
          title: item.title,
          count: count,
          image: item.paths?.screenshot || null,
        };
      }
    }
  }

  function calculateTopPerformers(stats, oCountEvents) {
    const performerCounts = oCountEvents.reduce((acc, curr) => {
      if (curr.item.performers) {
        curr.item.performers.forEach((p) => {
          acc[p.name] = (acc[p.name] || 0) + 1;
        });
      }
      return acc;
    }, {});

    stats.topPerformers = Object.entries(performerCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
  }

  function calculateDeepDive(stats, oCountEvents, year) {
    const oCountsByDay = oCountEvents.reduce((acc, curr) => {
      const day = new Date(curr.event).toISOString().substring(0, 10);
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});

    stats.peakDay = { date: "N/A", count: 0 };
    if (oCountEvents.length > 0) {
      for (const day in oCountsByDay) {
        if (oCountsByDay[day] > stats.peakDay.count) {
          stats.peakDay = { date: day, count: oCountsByDay[day] };
        }
      }
    }

    const peakDayEvents = oCountEvents.filter(
      (e) =>
        new Date(e.event).toISOString().substring(0, 10) === stats.peakDay.date,
    );
    const oCountsByHourOnPeakDay = peakDayEvents.reduce((acc, curr) => {
      const hour = new Date(curr.event).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {});

    stats.hourlyLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    stats.hourlyData = stats.hourlyLabels.map(
      (_, i) => oCountsByHourOnPeakDay[i] || 0,
    );

    const yearDays = new Set(Object.keys(oCountsByDay));
    stats.longestStreak = 0;
    stats.longestDrySpell = 0;
    let currentStreak = 0;
    let currentDrySpell = 0;
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    for (let d = startDate; d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateString = d.toISOString().substring(0, 10);
      if (yearDays.has(dateString)) {
        currentStreak++;
        stats.longestDrySpell = Math.max(
          stats.longestDrySpell,
          currentDrySpell,
        );
        currentDrySpell = 0;
      } else {
        currentDrySpell++;
        stats.longestStreak = Math.max(stats.longestStreak, currentStreak);
        currentStreak = 0;
      }
    }
    stats.longestStreak = Math.max(stats.longestStreak, currentStreak);
    stats.longestDrySpell = Math.max(stats.longestDrySpell, currentDrySpell);
  }

  function calculateSessionDurations(stats, allScenes, year) {
    stats.sessions = [];
    allScenes.forEach((scene) => {
      if (scene.play_history && scene.o_history) {
        const scenePlaysInYear = scene.play_history.filter(
          (p) => new Date(p).getFullYear() == year,
        );
        const sceneOsInYear = scene.o_history.filter(
          (o) => new Date(o).getFullYear() == year,
        );
        if (scenePlaysInYear.length > 0 && sceneOsInYear.length > 0) {
          scenePlaysInYear.forEach((play) => {
            const playTime = new Date(play);
            const oneHourAfterPlay = new Date(
              playTime.getTime() + 60 * 60 * 1000,
            );
            const potentialOs = sceneOsInYear.filter((o) => {
              const oTime = new Date(o);
              return oTime >= playTime && oTime <= oneHourAfterPlay;
            });
            if (potentialOs.length > 0) {
              const latestO = potentialOs.reduce((l, c) =>
                new Date(c) > new Date(l) ? c : l,
              );
              const duration = (new Date(latestO) - playTime) / 1000;
              stats.sessions.push({ sceneTitle: scene.title, duration });
            }
          });
        }
      }
    });
    stats.sessions.sort((a, b) => a.duration - b.duration);
    stats.shortestSessions = stats.sessions.slice(0, 5);
    stats.longestSessions = stats.sessions.slice(-5).reverse();
  }

  function calculateTagStats(stats, oCountEvents) {
    const tagCounts = oCountEvents.reduce((acc, curr) => {
      if (curr.item.tags) {
        curr.item.tags.forEach((t) => {
          if (!acc[t.name])
            acc[t.name] = { count: 0, byMonth: Array(12).fill(0) };
          acc[t.name].count++;
          acc[t.name].byMonth[new Date(curr.event).getMonth()]++;
        });
      }
      return acc;
    }, {});
    stats.topTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 8);
    stats.top3Tags = stats.topTags.slice(0, 3);
  }

  function calculatePlayCountStats(stats, playEvents) {
    const playCountsByTag = playEvents.reduce((acc, curr) => {
      if (curr.item.tags) {
        curr.item.tags.forEach((t) => {
          if (!acc[t.name])
            acc[t.name] = { count: 0, byMonth: Array(12).fill(0) };
          acc[t.name].count++;
          acc[t.name].byMonth[new Date(curr.event).getMonth()]++;
        });
      }
      return acc;
    }, {});

    stats.topPlayTags = Object.entries(playCountsByTag)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 8);
  }

  function calculateTimelineData(stats, oCountEvents) {
    stats.timeline = Array(12)
      .fill(0)
      .map(() => []);
    oCountEvents.forEach((e) => {
      const month = new Date(e.event).getMonth();
      stats.timeline[month].push(e);
    });
  }

  // =================
  // UI Rendering
  // =================
  function renderGeneralStats({
    newScenes,
    newScenesImage,
    newImages,
    newImagesImage,
    totalOCounts,
    totalOCountsImage,
    topOScene,
  }) {
    const SVG_SIZE = "3vw";
    const VIEWBOX_SIZES = "0 0 38 38";

    const GREEN_FILL = "#28a745";
    const RED_FILL = "#dc3545";

    const TRIANGLE_UP = `<svg viewBox="${VIEWBOX_SIZES}" width="${SVG_SIZE}" height="${SVG_SIZE}" style="display:inline-block; vertical-align:middle;"><path d="M18 6L4.5 30H 31.5L 18 6Z" fill="${GREEN_FILL}"></path></svg>`;
    const TRIANGLE_DOWN = `<svg viewBox="${VIEWBOX_SIZES}" width="${SVG_SIZE}" height="${SVG_SIZE}" style="display:inline-block; vertical-align:middle;"><path d="M18 30L 31.5 6H 4.5L 18 30Z" fill="${RED_FILL}"></path></svg>`;

    const O_COUNT_PATH =
      "M22.855.758L7.875 7.024l12.537 9.733c2.633 2.224 6.377 2.937 9.77 1.518c4.826-2.018 7.096-7.576 5.072-12.413C33.232 1.024 27.68-1.261 22.855.758zm-9.962 17.924L2.05 10.284L.137 23.529a7.993 7.993 0 0 0 2.958 7.803a8.001 8.001 0 0 0 9.798-12.65zm15.339 7.015l-8.156-4.69l-.033 9.223c-.088 2 .904 3.98 2.75 5.041a5.462 5.462 0 0 0 7.479-2.051c1.499-2.644.589-6.013-2.04-7.523z";
    const O_COUNT_SYMBOL_UP = `<svg viewBox="${VIEWBOX_SIZES}" width="${SVG_SIZE}" height="${SVG_SIZE}" style="display:inline-block; vertical-align:middle;"><path d="${O_COUNT_PATH}" fill="${GREEN_FILL}"></path></svg>`;
    const O_COUNT_SYMBOL_DOWN = `<svg viewBox="${VIEWBOX_SIZES}" width="${SVG_SIZE}" height="${SVG_SIZE}" style="display:inline-block; vertical-align:middle;"><path d="${O_COUNT_PATH}" fill="${RED_FILL}"></path></svg>`;

    const renderStatBox = (
      title,
      boxSubtitle,
      value,
      imageUrl,
      defaultTitle,
      statType,
    ) => {
      const backgroundStyle = imageUrl
        ? `background-image: url('${imageUrl}');`
        : "";
      const noImageClass = imageUrl ? "" : "no-image";
      const boxTitle = value > 0 ? title : defaultTitle;

      let symbolHtml = "";
      let symbolColorClass = "";

      // TODO: Pass this from outside instead of handling it in here
      if (value > 0) {
        if (statType === "scenes" || statType === "images") {
          symbolHtml = TRIANGLE_UP;
        } else if (statType === "ocounts") {
          symbolHtml = O_COUNT_SYMBOL_UP;
        }
      } else {
        if (statType === "scenes" || statType === "images") {
          symbolHtml = TRIANGLE_DOWN;
        } else if (statType === "ocounts") {
          symbolHtml = O_COUNT_SYMBOL_DOWN;
        }
      }

      return `
        <div class="stat-box ${noImageClass}" style="${backgroundStyle}">
          <div class="stat-box-overlay">
            <div class="stat-box-value-container">
            <div class="stat-box-symbol ${symbolColorClass}">${symbolHtml}</div>
            <div class="stat-box-value">${value}</div>
          </div>
          <div class="stat-box-title">${boxTitle}</div>
          <div class="stat-box-subtitle">${boxSubtitle}</div>
          </div>
        </div>
      `;
    };

    return `
      <div class="col-md-12">
        <h3>General Stats</h3>
        <div class="stat-box-container">
          ${renderStatBox("Scenes", "Added", newScenes, newScenesImage, "No New Scenes", "scenes")}
          ${renderStatBox("Images", "Added", newImages, newImagesImage, "No New Images", "images")}
          ${renderStatBox("O-Count Increases", "Achieved", totalOCounts, totalOCountsImage, "No O-Counts", "ocounts")}
          ${renderStatBox("Most O-Count Increases Caused By", topOScene.title, topOScene.count, topOScene.image, "No Top O-Count Scene", "ocounts")}
        </div>
      </div>`;
  }

  function renderTopPerformers({ topPerformers }) {
    if (!topPerformers || topPerformers.length === 0) return "";
    return `
      <div class="col-md-6">
        <h3>Top Performers by O-Count</h3>
        <ol>${topPerformers.map(([name, count]) => `<li>${name} (${count})</li>`).join("")}</ol>
      </div>`;
  }

  function renderDeepDive(
    { peakDay, longestStreak, longestDrySpell },
    oCountEvents,
  ) {
    if (oCountEvents.length === 0) return "";
    return `
      <div class="col-md-12">
        <h3>O-Count Deep-Dive</h3>
        <p><b>Peak Day:</b> ${peakDay.date} (${peakDay.count} O-Counts)</p>
        <p><b>Longest O-Count Streak:</b> ${longestStreak} days</p>
        <p><b>Longest Dry Spell:</b> ${longestDrySpell} days</p>
        <div style="position: relative; height:300px; margin-top: 20px;"><canvas id="hourly-breakdown-chart"></canvas></div>
      </div>`;
  }

  function renderSessionDurations({
    sessions,
    longestSessions,
    shortestSessions,
  }) {
    if (!sessions || sessions.length < 5) return "";
    return `
      <div class="col-md-12">
        <h3>Session Durations</h3>
        <div class="row">
            <div class="col-md-6">
                <h4>5 Longest Sessions</h4>
                <ol>${longestSessions.map((s) => `<li>${s.sceneTitle} (${Math.round(s.duration)}s)</li>`).join("")}</ol>
            </div>
            <div class="col-md-6">
                <h4>5 Shortest Sessions</h4>
                <ol>${shortestSessions.map((s) => `<li>${s.sceneTitle} (${Math.round(s.duration)}s)</li>`).join("")}</ol>
            </div>
        </div>
      </div>`;
  }

  function renderTagStats({ topTags, top3Tags }) {
    if (!topTags || topTags.length < 3) {
      return "";
    }
    return `
        <div class="col-md-12">
            <h3>Tag Statistics</h3>
            <div class="row">
                <div class="col-md-6">
                    <h4>Top 8 Tags by O-Count</h4>
                    <div style="position: relative; height:400px;"><canvas id="tag-radar-chart"></canvas></div>
                </div>
                <div class="col-md-6">
                    <h4>Top 3 Tags Monthly Breakdown</h4>
                    ${top3Tags.map((_, i) => `<div style="position: relative; height:130px;"><canvas id="tag-breakdown-chart-${i}"></canvas></div>`).join("")}
                </div>
            </div>
        </div>
    `;
  }

  function renderPlayCountStats({ topPlayTags }) {
    if (!topPlayTags || topPlayTags.length < 1) return "";
    return `
        <div class="col-md-12">
            <h3>Play Count by Tag</h3>
            <div style="position: relative; height:400px;"><canvas id="play-count-by-tag-chart"></canvas></div>
        </div>
    `;
  }

  function renderTimeline(stats) {
    if (stats.totalOCounts === 0) return "";

    const monthLabels = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    let timelineHtml =
      '<div class="col-md-12"><h3>Timeline</h3><ul class="timeline">';

    stats.timeline.forEach((monthEvents, i) => {
      if (monthEvents.length > 0) {
        timelineHtml += `
                <li>
                  <div class="timeline-badge">${monthEvents.length}</div>
                  <div class="timeline-panel">
                    <div class="timeline-heading">
                      <h4 class="timeline-title">${monthLabels[i]}</h4>
                    </div>
                    <div class="timeline-body">
                      <p>You had ${monthEvents.length} O-events this month.</p>
                    </div>
                  </div>
                </li>
            `;
      }
    });

    timelineHtml += "</ul></div>";
    return timelineHtml;
  }

  function drawCharts(stats) {
    if (stats.totalOCounts > 0 && window.stashGraphs?.drawBarChart) {
      window.stashGraphs.drawBarChart(
        "hourly-breakdown-chart",
        stats.hourlyLabels,
        stats.hourlyData,
        "O-Counts",
        `Hourly Breakdown on ${stats.peakDay.date}`,
        "rgba(75, 192, 192, 0.5)",
        "rgba(75, 192, 192, 1)",
      );
    }
    console.log(window.stashGraphs);
    if (stats.topTags?.length >= 3 && window.stashGraphs?.drawRadarChart) {
      console.log("Attempting to draw radar chart");
      const radarLabels = stats.topTags.map(([name, _]) => name);
      const radarData = {
        label: "O-Counts",
        data: stats.topTags.map(([_, data]) => data.count),
        fill: true,
        backgroundColor: "rgba(255, 99, 192, 0.2)",
        borderColor: "rgb(255, 99, 192)",
        pointBackgroundColor: "rgb(255, 99, 192)",
      };
      window.stashGraphs.drawRadarChart(
        "tag-radar-chart",
        radarLabels,
        [radarData],
        "Top 8 Tags",
      );
    } else {
      console.log("Skipping drawing radar chart");
    }
    if (stats.top3Tags?.length > 0 && window.stashGraphs?.drawBarChart) {
      const monthLabels = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      stats.top3Tags.forEach(([name, tagData], i) => {
        window.stashGraphs.drawBarChart(
          `tag-breakdown-chart-${i}`,
          monthLabels,
          tagData.byMonth,
          "O-Counts",
          `${name} - Monthly O-Counts`,
          "rgba(255, 159, 64, 0.5)",
          "rgba(255, 159, 64, 1)",
        );
      });
    }
    if (stats.topPlayTags?.length >= 1 && window.stashGraphs?.drawBarChart) {
      const playCountLabels = stats.topPlayTags.map(([name, _]) => name);
      const playCountData = stats.topPlayTags.map(([_, data]) => data.count);
      window.stashGraphs.drawBarChart(
        "play-count-by-tag-chart",
        playCountLabels,
        playCountData,
        "Play Count",
        "Top Tags by Play Count",
        "rgba(54, 162, 235, 0.5)",
        "rgba(54, 162, 235, 1)",
        "y",
      );
    }
  }

  // =================
  // Main Functions
  // =================
  async function getAvailableYears() {
    // TODO: This filter can be defined in one place and used where possible
    const variables = {
      scene_filter: {
        OR: {
          o_counter: { value: 0, modifier: "GREATER_THAN" },
          play_count: { value: 0, modifier: "GREATER_THAN" },
        },
      },
    };
    const data = await performGraphQLQuery(HISTORY_QUERY, variables);
    console.log(data);
    const years = new Set();
    const currentYear = new Date().getFullYear();
    const scenes = data?.findScenes?.scenes || [];

    scenes.forEach((s) => {
      if (s.o_history)
        s.o_history.forEach((o) => years.add(new Date(o).getFullYear()));
      if (s.play_history)
        s.play_history.forEach((p) => years.add(new Date(p).getFullYear()));
    });

    return Array.from(years)
      .filter((year) => year <= currentYear)
      .sort((a, b) => b - a);
  }

  async function generateStatsForYear(year) {
    const contentDiv = document.getElementById("unwind-stats-content");
    contentDiv.innerHTML = `<p>Loading statistics for ${year}...</p>`;
    try {
      const variables = {
        scene_filter: {
          OR: {
            o_counter: { value: 0, modifier: "GREATER_THAN" },
            play_count: { value: 0, modifier: "GREATER_THAN" },
          },
        },
        image_filter: { o_counter: { value: 0, modifier: "GREATER_THAN" } },
      };
      const data = await performGraphQLQuery(UNWIND_ITEMS_QUERY, variables);
      const allScenes = data.findScenes.scenes || [];
      const allImages = data.findImages.images || [];

      const oCountEvents = [];
      const playEvents = [];
      allScenes.forEach((s) => {
        if (s.o_history)
          s.o_history.forEach((o) => {
            if (new Date(o).getFullYear() == year)
              oCountEvents.push({ item: s, event: o });
          });
        if (s.play_history)
          s.play_history.forEach((p) => {
            if (new Date(p).getFullYear() == year)
              playEvents.push({ item: s, event: p });
          });
      });

      const stats = {};
      calculateGeneralStats(stats, oCountEvents, allScenes, allImages, year);
      calculateTopPerformers(stats, oCountEvents);
      calculateDeepDive(stats, oCountEvents, year);
      calculateSessionDurations(stats, allScenes, year);
      calculateTagStats(stats, oCountEvents);
      calculatePlayCountStats(stats, playEvents);
      calculateTimelineData(stats, oCountEvents);

      contentDiv.innerHTML = `
            <div class="row">${renderGeneralStats(stats)}</div>
            <div class="row">${renderTopPerformers(stats)}</div>
            <hr>${renderDeepDive(stats, oCountEvents) ? `<div class="row">${renderDeepDive(stats, oCountEvents)}</div><hr>` : ""}
            ${renderSessionDurations(stats) ? `<div class="row">${renderSessionDurations(stats)}</div><hr>` : ""}
            ${renderTagStats(stats) ? `<div class="row">${renderTagStats(stats)}</div><hr>` : ""}
            ${renderPlayCountStats(stats) ? `<div class="row">${renderPlayCountStats(stats)}</div><hr>` : ""}
            ${renderTimeline(stats) ? `<div class="row">${renderTimeline(stats)}</div>` : ""}
        `;

      drawCharts(stats);
    } catch (e) {
      console.error(e);
      contentDiv.innerHTML = `<p style="color: red;">Error generating statistics: ${e.message}</p>`;
    }
  }

  async function renderUnwindStatsSection(targetElement) {
    let statsContainer = targetElement.querySelector("#unwind-stats-section");
    if (statsContainer) return;

    statsContainer = document.createElement("div");
    statsContainer.id = "unwind-stats-section";
    statsContainer.className = "unwind-plugin-container";
    statsContainer.innerHTML = `
        <div class="unwind-header">
        <h2>Unwind - A Year in Review</h2>
        <div class="year-selector-container">
            <label for="unwind-year-selector">Select Year:</label>
            <select id="unwind-year-selector" class="form-control"></select>
        </div>
        </div>
        <div id="unwind-stats-content"><p>Loading available years...</p></div>
    `;
    targetElement.appendChild(statsContainer);

    const yearSelector = document.getElementById("unwind-year-selector");
    const contentDiv = document.getElementById("unwind-stats-content");

    try {
      const availableYears = await getAvailableYears();
      if (availableYears.length > 0) {
        yearSelector.innerHTML = "";
        availableYears.forEach((year) => {
          const option = document.createElement("option");
          option.value = year;
          option.textContent = year;
          yearSelector.appendChild(option);
        });
        yearSelector.addEventListener("change", (e) =>
          generateStatsForYear(e.target.value),
        );
        generateStatsForYear(availableYears[0]);
      } else {
        contentDiv.innerHTML =
          "<p>No completed years with data available to generate statistics.</p>";
        yearSelector.style.display = "none";
      }
    } catch (e) {
      console.error(e);
      contentDiv.innerHTML = `<p style="color: red;">Error loading data: ${e.message}</p>`;
    }
  }

  if (typeof csLib !== "undefined" && csLib.PathElementListener) {
    csLib.PathElementListener(
      "/stats",
      "div.container-fluid div.mt-5",
      renderUnwindStatsSection,
    );
  } else {
    console.error(
      "CommunityScriptsUILibrary (csLib) not found or PathElementListener is missing.",
    );
  }

  console.log("Unwind Plugin fully initialized");
})();
