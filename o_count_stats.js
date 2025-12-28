(async function () {
  "use strict";
  if (window.stashOCountStatsPluginLoaded) {
    console.log("OCount Statistics Plugin is already loaded");
    return;
  }
  window.stashOCountStatsPluginLoaded = true;

  console.log("OCount Statistics Plugin started");

  // =======
  // GraphQL
  // =======
  const performGraphQLQuery = async (query, variables = {}) => {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

  const SCENE_QUERY = `
    query FindScenesWithOCount($scene_filter: SceneFilterType) {
      findScenes(scene_filter: $scene_filter) {
        count
        scenes {
          id
          title
          rating100
          o_counter
          created_at
          updated_at
          last_played_at
          play_count
          tags { id, name }
          performers { id, name }
          studio { id, name }
        }
      }
    }
  `;

  const IMAGE_QUERY = `
    query FindImagesWithOCount($image_filter: ImageFilterType) {
      findImages(image_filter: $image_filter) {
        count
        images {
          id
          title
          rating100
          o_counter
          created_at
          updated_at
          tags { id, name }
          performers { id, name }
          studio { id, name }
        }
      }
    }
  `;

  const COMMON_FILTER_VARABLES = {
    o_counter: {
      value: 0,
      modifier: "GREATER_THAN",
    },
  };

  const SCENE_FILTER_VARIABLES = {
    scene_filter: {
      ...COMMON_FILTER_VARABLES,
    },
  };

  const IMAGE_FILTER_VARIABLES = {
    image_filter: {
      ...COMMON_FILTER_VARABLES,
    },
  };

  // ===============
  // Data Processing
  // ===============
  const StatsCalculator = {
    getMostCommonTags(items, limit = 10) {
      const tagCounts = new Map();
      for (const item of items) {
        if (!item.tags) continue;
        for (const tag of item.tags) {
          tagCounts.set(tag.name, (tagCounts.get(tag.name) || 0) + 1);
        }
      }
      return [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
    },
    // Add more stats calculation methods here as needed
  };

  // ===============
  // Graph Rendering
  // ===============
  const drawMostCommonTagsChart = (items) => {
    if (typeof Chart === "undefined") {
      console.error("Chart.js is not loaded. Cannot draw chart.");
      return;
    }

    const ctx = document.getElementById("mostCommonTagsChart");
    if (!ctx) return;

    // Destroy existing chart instance if it exists to prevent re-rendering issues
    if (ctx.chart) {
      ctx.chart.destroy();
    }

    const mostCommonTags = StatsCalculator.getMostCommonTags(items, 15);

    ctx.chart = new Chart(ctx, {
      // Store chart instance on ctx
      type: "bar",
      data: {
        labels: mostCommonTags.map((t) => t[0]),
        datasets: [
          {
            label: "Tag Count",
            data: mostCommonTags.map((t) => t[1]),
            backgroundColor: "rgba(54, 162, 235, 0.5)",
            borderColor: "rgba(54, 162, 235, 1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        indexAxis: "y",
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: "#ccc", stepSize: 1 },
            grid: { color: "rgba(255,255,255,0.1)" },
          },
          y: {
            ticks: { color: "#ccc" },
            grid: { color: "rgba(255,255,255,0.1)" },
          },
        },
        plugins: {
          title: {
            text: "Most Common Tags",
            display: true,
          },
          legend: {
            display: false,
          },
        },
      },
    });
  };

  // ====================
  // Data Fetch & Process
  // ====================
  const fetchAndProcessOcountData = async () => {
    console.log("Fetching scenes with O-count > 0...");
    const sceneData = await performGraphQLQuery(
      SCENE_QUERY,
      SCENE_FILTER_VARIABLES,
    );
    console.log(
      `Found ${sceneData.findScenes.count} scenes:`,
      sceneData.findScenes.scenes,
    );

    console.log("Fetching images with O-count > 0...");
    const imageData = await performGraphQLQuery(
      IMAGE_QUERY,
      IMAGE_FILTER_VARIABLES,
    );
    console.log(
      `Found ${imageData.findImages.count} images:`,
      imageData.findImages.images,
    );

    const allItems = [
      ...sceneData.findScenes.scenes,
      ...imageData.findImages.images,
    ];

    console.log("OCount Statistics: Data fetched and combined.");
    return allItems;
  };

  // ====================
  // Stats Section Render
  // ====================
  const HEADER = "<h2>O-Count Statistics</h2>";
  const renderOcountStatsSection = async (targetElement) => {
    let statsContainer = targetElement.querySelector("#ocount-stats-section");
    if (statsContainer) {
      statsContainer.innerHTML = HEADER + "<p>Loading statistics...</p>";
    } else {
      statsContainer = document.createElement("div");
      statsContainer.id = "ocount-stats-section";
      // Add some styling for better integration with Stash's UI
      statsContainer.style.backgroundColor = "#1e1e1e";
      statsContainer.style.padding = "20px";
      statsContainer.style.borderRadius = "8px";
      statsContainer.style.marginTop = "20px";
      statsContainer.style.boxShadow = "0 0 10px rgba(0,0,0,0.3)";
      targetElement.appendChild(statsContainer);
      statsContainer.innerHTML = HEADER + "<p>Loading statistics...</p>";
    }

    try {
      const allItems = await fetchAndProcessOcountData(); // Fetch data here

      console.log("Calculating and rendering statistics...");
      let outputHTML = HEADER;
      if (typeof Chart === "undefined") {
        outputHTML += `<p style="color: yellow;">Chart.js library not found.</p>
                               <p>Please ensure Chart.js is correctly loaded in sessions.yml.</p>`;
      } else {
        outputHTML += `<div style="position: relative; height:400px"><canvas id="mostCommonTagsChart"></canvas></div>`;
      }
      statsContainer.innerHTML = outputHTML;

      drawMostCommonTagsChart(allItems);
      drawOcountByDateChart(allItems);
    } catch (e) {
      statsContainer.innerHTML = `<h2 style="color: red;">Error loading statistics:</h2><p>${e.message}</p>`;
      console.error(e);
    }
  };

  // =======================
  // Main Plugin Entry Point
  // =======================
  // Use csLib.PathElementListener to trigger rendering
  if (typeof csLib !== "undefined" && csLib.PathElementListener) {
    csLib.PathElementListener(
      "/stats",
      "div.container-fluid div.mt-5",
      renderOcountStatsSection,
    );
  } else {
    console.error(
      "CommunityScriptsUILibrary (csLib) not found or PathElementListener is missing. Cannot register stats page listener.",
    );
  }

  console.log("OCount Statistics Plugin fully initialized");
})();
